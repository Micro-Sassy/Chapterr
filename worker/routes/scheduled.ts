import { Hono } from "hono";
import { WAVE2_LIMITS } from "../../shared/constants";
import { SCHEDULED_MAX_LEAD_MS, SCHEDULED_MIN_LEAD_MS, scheduledMessageSchema } from "../../shared/schemas-chat";
import type { ScheduledMessage } from "../../shared/types-chat";
import type { AppEnv } from "../env";
import { all, first, run } from "../lib/db";
import { ApiError, badRequest, notFound } from "../lib/errors";
import { parseBody } from "../lib/http";
import type { Row } from "../lib/mappers";
import { newId, nowIso } from "../lib/util";
import { authorizeConversation } from "./messages";

/**
 * Scheduled messages (docs/FEATURES-2.md §3), mounted at /api/clubs/:clubId/scheduled.
 * A member sees and cancels only their own pending sends; the cron
 * (worker/lib/digest.ts runScheduledMessages) posts due ones as the sender.
 */
export const scheduledRoutes = new Hono<AppEnv>();

const SELECT = `SELECT s.id, s.conversation_id, s.body, s.send_at, s.created_at, c.kind, c.room_id, r.title AS room_title, ou.name AS other_name
  FROM scheduled_messages s
  JOIN conversations c ON c.id = s.conversation_id
  LEFT JOIN discussion_rooms r ON r.id = c.room_id
  LEFT JOIN conversation_participants op ON op.conversation_id = c.id AND op.user_id <> s.sender_id AND c.kind = 'direct' AND c.room_id IS NULL
  LEFT JOIN "user" ou ON ou.id = op.user_id`;

function mapScheduled(r: Row, clubName: string): ScheduledMessage {
  const title = r.room_id ? String(r.room_title ?? "Room") : r.kind === "club" ? clubName : String(r.other_name ?? "Former member");
  return {
    id: String(r.id),
    conversationId: String(r.conversation_id),
    conversationTitle: title,
    body: String(r.body),
    sendAt: String(r.send_at),
    createdAt: String(r.created_at),
  };
}

/** The caller's pending scheduled messages in this club, soonest first. */
scheduledRoutes.get("/", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const rows = await all<Row>(
    c.env.DB,
    `${SELECT} WHERE s.club_id = ? AND s.sender_id = ? AND s.sent_at IS NULL AND s.canceled_at IS NULL ORDER BY s.send_at`,
    club.id,
    user.id,
  );
  return c.json(rows.map((r) => mapScheduled(r, club.name)));
});

scheduledRoutes.post("/", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const input = await parseBody(c, scheduledMessageSchema);
  const sendAt = new Date(input.sendAt);
  const lead = sendAt.getTime() - Date.now();
  if (lead < SCHEDULED_MIN_LEAD_MS) throw badRequest("Pick a time at least two minutes from now", { sendAt: ["Too soon"] });
  if (lead > SCHEDULED_MAX_LEAD_MS) throw badRequest("Pick a time within the next 90 days", { sendAt: ["Too far ahead"] });
  // Same access and gate rules as sending now.
  await authorizeConversation(c.env.DB, club.id, input.conversationId, user.id);
  const pending = await first<{ n: number }>(
    c.env.DB,
    "SELECT COUNT(*) AS n FROM scheduled_messages WHERE club_id = ? AND sender_id = ? AND sent_at IS NULL AND canceled_at IS NULL",
    club.id,
    user.id,
  );
  if (Number(pending?.n ?? 0) >= WAVE2_LIMITS.scheduledMessagesPerUser) {
    throw new ApiError(409, "limit_reached", `You can have at most ${WAVE2_LIMITS.scheduledMessagesPerUser} scheduled messages waiting in a club`);
  }
  const id = newId();
  await run(
    c.env.DB,
    "INSERT INTO scheduled_messages (id, club_id, conversation_id, sender_id, body, send_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    club.id,
    input.conversationId,
    user.id,
    input.body,
    sendAt.toISOString(),
    nowIso(),
  );
  const row = await first<Row>(c.env.DB, `${SELECT} WHERE s.id = ?`, id);
  return c.json(mapScheduled(row!, club.name), 201);
});

/** Cancel one of the caller's pending sends. */
scheduledRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const res = await run(
    c.env.DB,
    "UPDATE scheduled_messages SET canceled_at = ? WHERE id = ? AND club_id = ? AND sender_id = ? AND sent_at IS NULL AND canceled_at IS NULL",
    nowIso(),
    c.req.param("id"),
    club.id,
    user.id,
  );
  if (res.meta.changes === 0) throw notFound("Scheduled message not found");
  return c.json({ ok: true });
});
