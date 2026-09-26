import { Hono } from "hono";
import type { AppNotification } from "../../shared/types";
import type { AppEnv } from "../env";
import { all, first, run } from "../lib/db";
import { queryInt } from "../lib/http";
import { mapMemberOrNull, memberCols, type Row } from "../lib/mappers";
import { nowIso } from "../lib/util";

export const notificationRoutes = new Hono<AppEnv>();

notificationRoutes.get("/", async (c) => {
  const user = c.get("user");
  const limit = queryInt(c, "limit", 50, 1, 200);
  const rows = await all<Row>(
    c.env.DB,
    `SELECT n.*, ${memberCols("u", "a_")} FROM notifications n LEFT JOIN "user" u ON u.id = n.actor_id
     WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT ?`,
    user.id,
    limit,
  );
  const items: AppNotification[] = rows.map((r) => ({
    id: String(r.id),
    kind: r.kind as AppNotification["kind"],
    title: String(r.title),
    body: (r.body as string | null) ?? null,
    link: (r.link as string | null) ?? null,
    actor: mapMemberOrNull(r, "a_"),
    createdAt: String(r.created_at),
    readAt: (r.read_at as string | null) ?? null,
  }));
  return c.json(items);
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
