import { Hono } from "hono";
import type { AppNotification } from "../../shared/types";
import type { AppEnv } from "../env";
import { all, first, run } from "../lib/db";
import { badRequest } from "../lib/errors";
import { mapMemberOrNull, memberCols, type Row } from "../lib/mappers";
import { makePage, pageQuery, timeCursor } from "../lib/paging";
import { nowIso } from "../lib/util";

export const notificationRoutes = new Hono<AppEnv>();

function mapNotification(r: Row): AppNotification {
  return {
    id: String(r.id),
    clubId: (r.club_id as string | null) ?? null,
    clubName: (r.club_name as string | null) ?? null,
    kind: r.kind as AppNotification["kind"],
    title: String(r.title),
    body: (r.body as string | null) ?? null,
    link: (r.link as string | null) ?? null,
    actor: mapMemberOrNull(r, "a_"),
    createdAt: String(r.created_at),
    readAt: (r.read_at as string | null) ?? null,
  };
}

/** Paged, newest first. `nextCursor` is the created_at of the last item. */
notificationRoutes.get("/", async (c) => {
  const user = c.get("user");
  const { cursor, limit } = pageQuery(c);
  if (cursor && !timeCursor(cursor)) throw badRequest("Invalid cursor");
  const rows = await all<Row>(
    c.env.DB,
    `SELECT n.*, cl.name AS club_name, ${memberCols("u", "a_")} FROM notifications n
       LEFT JOIN "user" u ON u.id = n.actor_id
       LEFT JOIN clubs cl ON cl.id = n.club_id
     WHERE n.user_id = ? ${cursor ? "AND n.created_at < ?" : ""} ORDER BY n.created_at DESC, n.id LIMIT ?`,
    ...(cursor ? [user.id, cursor, limit + 1] : [user.id, limit + 1]),
  );
  return c.json(makePage(rows.map(mapNotification), limit, (n) => n.createdAt));
});

notificationRoutes.get("/unread-count", async (c) => {
  const row = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL", c.get("user").id);
  return c.json({ count: Number(row?.n ?? 0) });
});

notificationRoutes.post("/:id/read", async (c) => {
  await run(c.env.DB, "UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?", nowIso(), c.req.param("id"), c.get("user").id);
  return c.json({ ok: true });
});

notificationRoutes.post("/read-all", async (c) => {
  await run(c.env.DB, "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", nowIso(), c.get("user").id);
  return c.json({ ok: true });
});

notificationRoutes.delete("/:id", async (c) => {
  await run(c.env.DB, "DELETE FROM notifications WHERE id = ? AND user_id = ?", c.req.param("id"), c.get("user").id);
  return c.json({ ok: true });
});
