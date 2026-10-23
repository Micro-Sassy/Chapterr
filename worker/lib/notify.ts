import type { NotificationKind } from "../../shared/constants";
import type { AppNotification } from "../../shared/types";
import { createEmailProvider } from "../email";
import { clubUpdateEmail } from "../email/templates";
import type { Env } from "../env";
import { publish } from "../realtime/publish";
import { all, first, placeholders } from "./db";
import { mapMemberOrNull, memberCols, type Row } from "./mappers";
import { newId, nowIso } from "./util";

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
};

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  actorId: string;
  /** The club the notice belongs to; null for account-level notices. */
  clubId: string | null;
}

/**
 * Create in-app notifications for the given recipients (respecting each
 * member's preferences) and push them over the club's realtime channel.
 * `"club"` addresses every member of `input.clubId`. Never notifies the actor.
 */
export async function notifyUsers(env: Env, recipientIds: string[] | "club", input: NotifyInput): Promise<void> {
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
