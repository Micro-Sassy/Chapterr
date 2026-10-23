import type { NotificationKind } from "../../shared/constants";
import type { AppNotification } from "../../shared/types";
import { createEmailProvider } from "../email";
import { clubUpdateEmail } from "../email/templates";
import type { Env } from "../env";
import { publish } from "../realtime/publish";
import { sendSms } from "../sms";
import { all, bool, first, placeholders } from "./db";
import { mapMemberOrNull, memberCols, type Row } from "./mappers";
import { newId, nowIso } from "./util";
import { sendPush } from "./webpush";

/**
 * Which preference switches a kind off. Membership notices (joined, role
 * changed, removed) are always delivered: a member must learn about them.
 */
const PREF_COLUMN: Record<NotificationKind, string | null> = {
  direct_message: "inapp_direct_messages",
  recommendation: "inapp_recommendations",
  club_assignment: "inapp_club_updates",
  club_meeting: "inapp_club_updates",
  review_reaction: "inapp_reactions",
  club_member_joined: null,
  club_role_changed: null,
  club_removed: null,
  // Feature wave 2 (docs/FEATURES-2.md §8). Reminders, joins, mentions and digests are always delivered in-app;
  // push/email/SMS channels apply their own preference columns.
  meeting_reminder: null,
  rsvp_update: "inapp_club_updates",
  poll_opened: "inapp_club_updates",
  poll_closed: "inapp_club_updates",
  join_request: null,
  join_approved: null,
  mention: null,
  thread_reply: "inapp_direct_messages",
  reaction: "inapp_reactions",
  digest: null,
  challenge_update: "inapp_club_updates",
  welcome: null,
};

export interface NotifyChannels {
  /** Web Push to members with `push_enabled` (plus the kind's own switch). Default: on. */
  push?: boolean;
  /** SMS to opted-in members. Default: on for `meeting_reminder` only. */
  sms?: boolean;
  /** Email (pref `email_meeting_reminders`, clubUpdateEmail layout). Default: off; W1's reminder cron sends its own email. */
  email?: boolean;
}

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  actorId: string;
  /** The club the notice belongs to; null for account-level notices. */
  clubId: string | null;
  /** Override which extra channels fan out (see NotifyChannels defaults). */
  channels?: NotifyChannels;
}

/** Per-kind push switch on top of `push_enabled`. */
const PUSH_PREF_COLUMN: Partial<Record<NotificationKind, string>> = {
  mention: "push_mentions",
  thread_reply: "push_mentions",
  reaction: "push_mentions",
  meeting_reminder: "push_meeting_reminders",
};

interface ChannelPrefRow {
  user_id: string;
  push_enabled: number | null;
  push_mentions: number | null;
  push_meeting_reminders: number | null;
  email_meeting_reminders: number | null;
  email: string;
  name: string;
}

function prefOn(v: number | null | undefined): boolean {
  return v === null || v === undefined ? true : bool(v);
}

/**
 * Fan a notice out to push / SMS / email for the recipients who already got
 * the in-app copy. Best effort: every failure is logged, never thrown.
 */
async function fanOut(env: Env, recipients: string[], input: NotifyInput, clubName: string | null): Promise<void> {
  const channels: Required<NotifyChannels> = {
    push: input.channels?.push ?? true,
    sms: input.channels?.sms ?? input.kind === "meeting_reminder",
    email: input.channels?.email ?? false,
  };
  if (!channels.push && !channels.sms && !channels.email) return;
  let rows: ChannelPrefRow[];
  try {
    rows = await all<ChannelPrefRow>(
      env.DB,
      `SELECT u.id AS user_id, u.email, u.name, np.push_enabled, np.push_mentions, np.push_meeting_reminders, np.email_meeting_reminders
         FROM "user" u LEFT JOIN notification_preferences np ON np.user_id = u.id
        WHERE u.id IN (${placeholders(recipients.length)})`,
      ...recipients,
    );
  } catch (err) {
    console.error("notification fan-out lookup failed", err instanceof Error ? err.message : err);
    return;
  }
  const link = input.link ?? "/";
  const payload = {
    title: clubName && !input.title.includes(clubName) ? `${clubName}: ${input.title}` : input.title,
    body: input.body ?? "",
    url: link,
    tag: `${input.kind}:${input.clubId ?? "account"}`,
  };
  const smsText = `${clubName ? `${clubName}: ` : ""}${input.title}${input.body ? ` ${input.body}` : ""}`.slice(0, 300);
  const tasks: Promise<unknown>[] = [];
  let emailProvider: ReturnType<typeof createEmailProvider> | null = null;
  if (channels.email) {
    try {
      emailProvider = createEmailProvider(env);
    } catch (err) {
      console.error("notification email skipped:", err instanceof Error ? err.message : err);
    }
  }
  for (const r of rows) {
    const kindCol = PUSH_PREF_COLUMN[input.kind];
    const pushAllowed = prefOn(r.push_enabled) && (!kindCol || prefOn(r[kindCol as keyof ChannelPrefRow] as number | null));
    if (channels.push && pushAllowed) tasks.push(sendPush(env, r.user_id, payload));
    if (channels.sms) tasks.push(sendSms(env, r.user_id, smsText));
    if (channels.email && emailProvider && prefOn(r.email_meeting_reminders) && clubName && input.clubId) {
      const url = `${env.PUBLIC_APP_URL.replace(/\/+$/, "")}${link}`;
      tasks.push(
        emailProvider.send(clubUpdateEmail(r.email, r.name, clubName, input.title, input.body ? [input.body] : [], url)).catch((err: unknown) => {
          console.error("notification email failed", err instanceof Error ? err.message : err);
        }),
      );
    }
  }
  await Promise.allSettled(tasks);
}

/**
 * Create in-app notifications for the given recipients (respecting each
 * member's preferences) and push them over the club's realtime channel, then
 * fan out to Web Push (and SMS / email for reminders) per member preferences.
 * `"club"` addresses every member of `input.clubId`. Never notifies the actor.
 * Pass `ctx` where one is available so the fan-out runs after the response.
 */
/** Anything with waitUntil (Hono's context, a Worker ExecutionContext). */
export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

export async function notifyUsers(env: Env, recipientIds: string[] | "club", input: NotifyInput, ctx?: WaitUntil): Promise<void> {
  const col = PREF_COLUMN[input.kind];
  // Members without a preferences row get the defaults (everything on).
  const prefFilter = col ? `AND COALESCE(np.${col}, 1) = 1` : "";
  let recipients: string[];
  if (recipientIds === "club") {
    if (!input.clubId) return;
    const rows = await all<{ user_id: string }>(
      env.DB,
      `SELECT m.user_id FROM club_members m
         JOIN "user" u ON u.id = m.user_id
         LEFT JOIN notification_preferences np ON np.user_id = m.user_id
        WHERE m.club_id = ? AND u."emailVerified" = 1 AND m.user_id <> ? AND m.muted = 0 ${prefFilter}`,
      input.clubId,
      input.actorId,
    );
    recipients = rows.map((r) => r.user_id);
  } else {
    const ids = Array.from(new Set(recipientIds.filter((id) => id !== input.actorId)));
    if (ids.length === 0) return;
    const rows = await all<{ id: string }>(
      env.DB,
      `SELECT u.id FROM "user" u LEFT JOIN notification_preferences np ON np.user_id = u.id
        WHERE u.id IN (${placeholders(ids.length)}) ${prefFilter}`,
      ...ids,
    );
    recipients = rows.map((r) => r.id);
  }
  if (recipients.length === 0) return;
  const now = nowIso();
  const [actor, club] = await Promise.all([
    first<Row>(env.DB, `SELECT ${memberCols("u", "m_")} FROM "user" u WHERE u.id = ?`, input.actorId),
    input.clubId ? first<{ name: string }>(env.DB, "SELECT name FROM clubs WHERE id = ?", input.clubId) : Promise.resolve(null),
  ]);
  const stmts: D1PreparedStatement[] = [];
  const created: { userId: string; notification: AppNotification }[] = [];
  for (const userId of recipients) {
    const id = newId();
    stmts.push(
      env.DB.prepare(
        "INSERT INTO notifications (id, user_id, club_id, kind, title, body, link, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(id, userId, input.clubId, input.kind, input.title, input.body ?? null, input.link ?? null, input.actorId, now),
    );
    created.push({
      userId,
      notification: {
        id,
        clubId: input.clubId,
        clubName: club?.name ?? null,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        actor: actor ? mapMemberOrNull(actor, "m_") : null,
        createdAt: now,
        readAt: null,
      },
    });
  }
  await env.DB.batch(stmts);
  // Club notices are pushed to that club's Durable Object; account-level notices are picked up by polling.
  const clubId = input.clubId;
  if (clubId) {
    await Promise.all(created.map((c) => publish(env, clubId, [c.userId], { type: "notification.created", notification: c.notification })));
  }
  const extra = fanOut(env, recipients, input, club?.name ?? null);
  if (ctx) ctx.waitUntil(extra);
  else {
    try {
      await extra;
    } catch (err) {
      console.error("notification fan-out failed", err instanceof Error ? err.message : err);
    }
  }
}

export interface ClubEmailInput {
  clubId: string;
  clubName: string;
  actorId: string;
  heading: string;
  lines: string[];
  /** App path the button opens, e.g. `/c/<clubId>/meetings`. */
  path: string;
  preference?: "email_club_updates" | "email_recommendations";
  /** Restrict to these members (still filtered by preference and membership). */
  onlyUserIds?: string[];
}

/** Email members of the club who opted in to club update emails (off by default). */
export async function emailClubUpdate(env: Env, input: ClubEmailInput): Promise<void> {
  const preference = input.preference ?? "email_club_updates";
  const rows = await all<{ email: string; name: string; id: string }>(
    env.DB,
    `SELECT u.id, u.email, u.name FROM club_members m
       JOIN "user" u ON u.id = m.user_id
       JOIN notification_preferences np ON np.user_id = u.id
      WHERE m.club_id = ? AND np.${preference} = 1 AND u."emailVerified" = 1 AND u.id <> ?`,
    input.clubId,
    input.actorId,
  );
  const targets = input.onlyUserIds ? rows.filter((r) => input.onlyUserIds!.includes(r.id)) : rows;
  if (targets.length === 0) return;
  let provider;
  try {
    provider = createEmailProvider(env);
  } catch (err) {
    console.error("club update email skipped:", err instanceof Error ? err.message : err);
    return;
  }
  const url = `${env.PUBLIC_APP_URL.replace(/\/+$/, "")}${input.path}`;
  for (const t of targets) {
    try {
      await provider.send(clubUpdateEmail(t.email, t.name, input.clubName, input.heading, input.lines, url));
    } catch (err) {
      console.error("club update email failed", err instanceof Error ? err.message : err);
    }
  }
}
