import type { NotificationKind } from "../../shared/constants";
import type { AppNotification } from "../../shared/types";
import { createEmailProvider } from "../email";
import { clubUpdateEmail } from "../email/templates";
import type { Env } from "../env";
import { publish } from "../realtime/publish";
import { all, first, placeholders } from "./db";
import { mapMemberOrNull, memberCols, type Row } from "./mappers";
import { newId, nowIso } from "./util";

const PREF_COLUMN: Record<NotificationKind, string> = {
  direct_message: "inapp_direct_messages",
  recommendation: "inapp_recommendations",
  club_assignment: "inapp_club_updates",
  club_meeting: "inapp_club_updates",
  review_reaction: "inapp_reactions",
};

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  actorId: string;
}

/**
 * Create in-app notifications for the given recipients (respecting each
 * member's preferences) and push them over realtime. Never notifies the actor.
 */
export async function notifyUsers(env: Env, recipientIds: string[] | "all", input: NotifyInput): Promise<void> {
  const col = PREF_COLUMN[input.kind];
  let recipients: string[];
  if (recipientIds === "all") {
    const rows = await all<{ user_id: string }>(
      env.DB,
      `SELECT np.user_id FROM notification_preferences np JOIN "user" u ON u.id = np.user_id
       WHERE np.${col} = 1 AND u.emailVerified = 1 AND np.user_id <> ?`,
      input.actorId,
    );
    recipients = rows.map((r) => r.user_id);
  } else {
    const ids = Array.from(new Set(recipientIds.filter((id) => id !== input.actorId)));
    if (ids.length === 0) return;
    const rows = await all<{ user_id: string }>(
      env.DB,
      `SELECT user_id FROM notification_preferences WHERE ${col} = 1 AND user_id IN (${placeholders(ids.length)})`,
      ...ids,
    );
    recipients = rows.map((r) => r.user_id);
  }
  if (recipients.length === 0) return;
  const now = nowIso();
  const actor = await first<Row>(env.DB, `SELECT ${memberCols("u", "m_")} FROM "user" u WHERE u.id = ?`, input.actorId);
  const stmts: D1PreparedStatement[] = [];
  const created: { userId: string; notification: AppNotification }[] = [];
  for (const userId of recipients) {
    const id = newId();
    stmts.push(
      env.DB.prepare(
        "INSERT INTO notifications (id, user_id, kind, title, body, link, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(id, userId, input.kind, input.title, input.body ?? null, input.link ?? null, input.actorId, now),
    );
    created.push({
      userId,
      notification: {
        id,
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
  await Promise.all(created.map((c) => publish(env, [c.userId], { type: "notification.created", notification: c.notification })));
}

/** Email members who opted in to club update emails (off by default). */
export async function emailClubUpdate(
  env: Env,
  actorId: string,
  heading: string,
  lines: string[],
  path: string,
  preference: "email_club_updates" | "email_recommendations" = "email_club_updates",
  onlyUserIds?: string[],
): Promise<void> {
  const rows = await all<{ email: string; name: string; id: string }>(
    env.DB,
    `SELECT u.id, u.email, u.name FROM "user" u JOIN notification_preferences np ON np.user_id = u.id
     WHERE np.${preference} = 1 AND u.emailVerified = 1 AND u.id <> ?`,
    actorId,
  );
  const targets = onlyUserIds ? rows.filter((r) => onlyUserIds.includes(r.id)) : rows;
  if (targets.length === 0) return;
  let provider;
  try {
    provider = createEmailProvider(env);
  } catch (err) {
    console.error("club update email skipped:", err instanceof Error ? err.message : err);
    return;
  }
  const url = `${env.PUBLIC_APP_URL.replace(/\/+$/, "")}${path}`;
  for (const t of targets) {
    try {
      await provider.send(clubUpdateEmail(t.email, t.name, heading, lines, url));
    } catch (err) {
      console.error("club update email failed", err instanceof Error ? err.message : err);
    }
  }
}
