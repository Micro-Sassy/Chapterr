import { createEmailProvider } from "../email";
import { digestEmail } from "../email/templates";
import type { Env } from "../env";
import { gateOpenSql, sendMessage } from "../routes/messages";
import { all, first, placeholders, run } from "./db";
import { ApiError } from "./errors";
import { notifyUsers } from "./notify";

/**
 * Feature wave 2 (W2) cron jobs: scheduled messages (every tick) and the daily
 * progress-gated catch-up digest (13:00 UTC tick). Both are idempotent: a
 * tick can be late, repeated or skipped (worker/cron.ts).
 */

interface DueRow {
  id: string;
  club_id: string;
  club_name: string;
  conversation_id: string;
  sender_id: string;
  body: string;
}

/**
 * Post due scheduled messages as their senders through the normal send path
 * (mentions, threads, realtime, unread). A sender who left the club, or whose
 * conversation is gone or locked, has the send canceled instead.
 */
export async function runScheduledMessages(env: Env, now: Date): Promise<void> {
  const iso = now.toISOString();
  const due = await all<DueRow>(
    env.DB,
    `SELECT s.id, s.club_id, c.name AS club_name, s.conversation_id, s.sender_id, s.body
       FROM scheduled_messages s JOIN clubs c ON c.id = s.club_id AND c.archived_at IS NULL
      WHERE s.sent_at IS NULL AND s.canceled_at IS NULL AND s.send_at <= ?
      ORDER BY s.send_at LIMIT 200`,
    iso,
  );
  for (const row of due) {
    // Claim first so two overlapping ticks never send the same message twice.
    const claimed = await run(env.DB, "UPDATE scheduled_messages SET sent_at = ? WHERE id = ? AND sent_at IS NULL AND canceled_at IS NULL", iso, row.id);
    if (claimed.meta.changes === 0) continue;
    const member = await first<{ n: number }>(env.DB, "SELECT 1 AS n FROM club_members WHERE club_id = ? AND user_id = ?", row.club_id, row.sender_id);
    if (!member) {
      await run(env.DB, "UPDATE scheduled_messages SET sent_at = NULL, canceled_at = ? WHERE id = ?", iso, row.id);
      continue;
    }
    try {
      const sent = await sendMessage(env, {
        clubId: row.club_id,
        clubName: row.club_name,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        body: row.body,
      });
      await run(env.DB, "UPDATE scheduled_messages SET sent_message_id = ?, sent_at = ? WHERE id = ?", sent.message.id, sent.message.createdAt, row.id);
      await sent.deliver();
    } catch (err) {
      if (err instanceof ApiError) {
        // Conversation gone, sender no longer allowed in, room locked: cancel rather than retry forever.
        await run(env.DB, "UPDATE scheduled_messages SET sent_at = NULL, canceled_at = ? WHERE id = ?", iso, row.id);
      } else {
        // Transient failure: release the claim so the next tick retries.
        await run(env.DB, "UPDATE scheduled_messages SET sent_at = NULL WHERE id = ? AND sent_message_id IS NULL", row.id);
        console.error("scheduled message failed", err instanceof Error ? err.message : err);
      }
    }
  }
}

const DIGEST_MIN_UNREAD = 10;
const DAY_MS = 86_400_000;

interface CandidateRow {
  user_id: string;
  user_name: string;
  user_email: string;
  email_verified: number;
  email_club_updates: number | null;
  conversation_id: string;
  club_id: string;
  club_name: string;
  kind: "club" | "direct";
  room_id: string | null;
  room_title: string | null;
  edition_id: string | null;
  since: string;
  unread: number;
}

interface TopMessage {
  id: string;
  conversation_id: string;
  body: string;
  created_at: string;
  sender_id: string;
  sender_name: string;
  reactions: number;
}

/**
 * For each member and each club chat or unlocked room with at least 10 unread
 * messages (since last_read_at, and newer than the last digest for that
 * conversation), send one in-app "digest" notice per club with counts and the
 * five most-reacted messages they may see, plus an email when club update
 * emails are on. Nothing from locked rooms ever appears. Recorded in
 * digest_deliveries, so the same conversation is digested at most once a day.
 */
export async function runCatchUpDigests(env: Env, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
  const candidates = await all<CandidateRow>(
    env.DB,
    `SELECT cm.user_id, u.name AS user_name, u.email AS user_email, u."emailVerified" AS email_verified, np.email_club_updates,
            c.id AS conversation_id, c.club_id, cl.name AS club_name, c.kind, c.room_id, r.title AS room_title, r.edition_id,
            MAX(COALESCE(me.last_read_at, CASE WHEN c.kind = 'club' THEN cm.joined_at ELSE me.joined_at END),
                COALESCE((SELECT tm.created_at FROM messages tm WHERE tm.id = dd.through_message_id), '')) AS since,
            COUNT(m.id) AS unread
       FROM club_members cm
       JOIN "user" u ON u.id = cm.user_id
       JOIN clubs cl ON cl.id = cm.club_id AND cl.archived_at IS NULL
       JOIN conversations c ON c.club_id = cm.club_id AND (c.kind = 'club' OR c.room_id IS NOT NULL)
       LEFT JOIN conversation_participants me ON me.conversation_id = c.id AND me.user_id = cm.user_id
       LEFT JOIN discussion_rooms r ON r.id = c.room_id
       LEFT JOIN club_reading_progress p ON p.club_id = c.club_id AND p.edition_id = r.edition_id AND p.user_id = cm.user_id
       LEFT JOIN notification_preferences np ON np.user_id = cm.user_id
       LEFT JOIN digest_deliveries dd ON dd.user_id = cm.user_id AND dd.conversation_id = c.id
       JOIN messages m ON m.conversation_id = c.id AND m.sender_id <> cm.user_id AND m.deleted_at IS NULL
            AND m.created_at > COALESCE(me.last_read_at, CASE WHEN c.kind = 'club' THEN cm.joined_at ELSE me.joined_at END)
            AND m.created_at > COALESCE((SELECT tm.created_at FROM messages tm WHERE tm.id = dd.through_message_id), '')
      WHERE COALESCE(np.digest_catch_up, 1) = 1 AND cm.muted = 0
        AND (c.kind = 'club' OR (me.user_id IS NOT NULL AND r.archived_at IS NULL AND ${gateOpenSql("r", "p")}))
        AND (dd.delivered_at IS NULL OR dd.delivered_at < ?)
      GROUP BY cm.user_id, c.id
     HAVING COUNT(m.id) >= ?
      ORDER BY cm.user_id, c.club_id, c.kind = 'club' DESC`,
    cutoff,
    DIGEST_MIN_UNREAD,
  );
  if (candidates.length === 0) return;

  // Group by member and club: one digest per member per club.
  const groups = new Map<string, CandidateRow[]>();
  for (const row of candidates) {
    const key = `${row.user_id}|${row.club_id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  let provider: ReturnType<typeof createEmailProvider> | null = null;
  const appUrl = env.PUBLIC_APP_URL.replace(/\/+$/, "");

  for (const rows of groups.values()) {
    const head = rows[0]!;
    const total = rows.reduce((n, r) => n + Number(r.unread), 0);
    const convIds = rows.map((r) => r.conversation_id);
    // Most-reacted unread messages across the member's qualifying conversations (top 5 per conversation, then overall).
    const perConversation = await Promise.all(
      rows.map((r) =>
        all<TopMessage>(
          env.DB,
          `SELECT m.id, m.conversation_id, m.body, m.created_at, m.sender_id, u.name AS sender_name,
                  (SELECT COUNT(*) FROM message_reactions mr WHERE mr.message_id = m.id) AS reactions
             FROM messages m JOIN "user" u ON u.id = m.sender_id
            WHERE m.conversation_id = ? AND m.sender_id <> ? AND m.deleted_at IS NULL AND m.created_at > ?
            ORDER BY reactions DESC, m.created_at DESC LIMIT 5`,
          r.conversation_id,
          r.user_id,
          r.since,
        ),
      ),
    );
    const top = perConversation
      .flat()
      .sort((a, b) => Number(b.reactions) - Number(a.reactions) || (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 5);
    const latest = await all<{ conversation_id: string; id: string; sender_id: string; created_at: string }>(
      env.DB,
      `SELECT m.conversation_id, m.id, m.sender_id, m.created_at FROM messages m
        WHERE m.conversation_id IN (${placeholders(convIds.length)}) AND m.sender_id <> ? AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC`,
      ...convIds,
      head.user_id,
    );
    const latestByConv = new Map<string, { id: string; sender_id: string }>();
    for (const l of latest) if (!latestByConv.has(l.conversation_id)) latestByConv.set(l.conversation_id, l);
    const actorId = latest[0]?.sender_id;
    if (!actorId) continue;

    const placeName = (r: CandidateRow) => (r.room_id ? `${r.room_title ?? "Room"} (room)` : "Club chat");
    const main = rows.find((r) => r.kind === "club") ?? head;
    const link = main.room_id
      ? `/c/${head.club_id}/rooms/${main.edition_id}?room=${main.room_id}`
      : `/c/${head.club_id}/messages/${main.conversation_id}`;
    const countLines = rows.map((r) => `${placeName(r)}: ${r.unread} new message${Number(r.unread) === 1 ? "" : "s"}`);
    const topLines = top.map((m) => `${m.sender_name}: "${m.body.replace(/\s+/g, " ").slice(0, 160)}"${Number(m.reactions) > 0 ? ` (${m.reactions} reaction${Number(m.reactions) === 1 ? "" : "s"})` : ""}`);

    await notifyUsers(env, [head.user_id], {
      kind: "digest",
      clubId: head.club_id,
      title: `Catch up on ${head.club_name}`,
      body: `${total} new message${total === 1 ? "" : "s"} in ${rows.length} conversation${rows.length === 1 ? "" : "s"}: ${countLines.join("; ")}`.slice(0, 500),
      link,
      actorId,
    });

    if (Number(head.email_club_updates ?? 0) === 1 && Number(head.email_verified) === 1) {
      try {
        provider ??= createEmailProvider(env);
        await provider.send(
          digestEmail(head.user_email, head.user_name, head.club_name, [...countLines, ...(topLines.length ? ["Most talked about:", ...topLines] : [])], `${appUrl}${link}`),
        );
      } catch (err) {
        console.error("digest email failed", err instanceof Error ? err.message : err);
      }
    }

    const iso = now.toISOString();
    await env.DB.batch(
      rows.map((r) =>
        env.DB.prepare(
          `INSERT INTO digest_deliveries (user_id, conversation_id, delivered_at, through_message_id) VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, conversation_id) DO UPDATE SET delivered_at = excluded.delivered_at, through_message_id = excluded.through_message_id`,
        ).bind(r.user_id, r.conversation_id, iso, latestByConv.get(r.conversation_id)?.id ?? null),
      ),
    );
  }
}
