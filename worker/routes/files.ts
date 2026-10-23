import { Hono, type Context } from "hono";
import { fileUploadFieldsSchema, filesQuerySchema, idSchema } from "../../shared/schemas";
import type { FileRecord, FileUsage, Page } from "../../shared/types";
import type { AppEnv } from "../env";
import { hasRole } from "../lib/club";
import { ApiError, badRequest, forbidden, notFound } from "../lib/errors";
import { parseWith } from "../lib/http";
import { makePage, pageQuery, timeCursor } from "../lib/paging";
import { clubUsage, deleteFile, fileOwner, getFile, listFiles, putFile, safeFilename } from "../lib/storage";
import { enforceRateLimit } from "../security/rate-limit";

/**
 * Club documents, photos, recipes, minutes, banners and chat attachments.
 * Mounted at /api/clubs/:clubId/files behind requireClubMember.
 */
export const fileRoutes = new Hono<AppEnv>();

const UPLOAD_LIMIT = { window: 60 * 60, max: 60 };

/** Read the multipart upload: `file` plus text fields. */
async function readUpload(c: Context<AppEnv>) {
  const type = c.req.header("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) throw badRequest("Upload the file as multipart/form-data");
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw badRequest("Could not read the upload");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Attach a file in the “file” field", { file: ["Required"] });
  const fields = parseWith(fileUploadFieldsSchema, {
    kind: form.get("kind") ?? undefined,
    title: typeof form.get("title") === "string" ? form.get("title") : undefined,
    meetingId: typeof form.get("meetingId") === "string" ? form.get("meetingId") : undefined,
  });
  return { file, fields };
}

fileRoutes.post("/", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  await enforceRateLimit(c.env, "file-upload", user.id, UPLOAD_LIMIT);
  const { file, fields } = await readUpload(c);
  if (fields.meetingId) {
    const meeting = await c.env.DB.prepare("SELECT 1 FROM club_meetings WHERE id = ? AND club_id = ?").bind(fields.meetingId, club.id).first();
    if (!meeting) throw notFound("Meeting not found");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const record = await putFile(c.env, {
    clubId: club.id,
    ownerId: user.id,
    kind: fields.kind,
    title: fields.title ?? (file.name ? file.name.replace(/\.[A-Za-z0-9]{1,5}$/, "") : null),
    filename: file.name || null,
    contentType: file.type || "application/octet-stream",
    bytes,
    meetingId: fields.meetingId,
  });
  return c.json(record satisfies FileRecord, 201);
});

fileRoutes.get("/", async (c) => {
  const club = c.get("club");
  const q = parseWith(filesQuerySchema, { kind: c.req.query("kind"), meetingId: c.req.query("meetingId") });
  const { cursor, limit } = pageQuery(c);
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q.kind) {
    where.push("AND f.kind = ?");
    params.push(q.kind);
  }
  if (q.meetingId) {
    where.push("AND f.meeting_id = ?");
    params.push(q.meetingId);
  }
  const before = timeCursor(cursor);
  if (before) {
    where.push("AND f.created_at < ?");
    params.push(before);
  }
  const rows = await listFiles(c.env, club.id, where.join(" "), params, limit + 1);
  return c.json(makePage(rows, limit, (f) => f.createdAt) satisfies Page<FileRecord>);
});

fileRoutes.get("/usage", async (c) => c.json((await clubUsage(c.env, c.get("club").id)) satisfies FileUsage));

fileRoutes.get("/:id", async (c) => {
  const club = c.get("club");
  const id = parseWith(idSchema, c.req.param("id"));
  const found = await getFile(c.env, club.id, id);
  if (!found) throw notFound("File not found");
  return c.json(found.record satisfies FileRecord);
});

/**
 * The bytes. Served inline with a locked-down CSP and nosniff so even a
 * mislabelled upload can never run as a page; cached privately per member.
 */
fileRoutes.get("/:id/content", async (c) => {
  const club = c.get("club");
  const id = parseWith(idSchema, c.req.param("id"));
  const found = await getFile(c.env, club.id, id);
  if (!found) throw notFound("File not found");
  const { record, body } = found;
  const download = c.req.query("download") === "1";
  const filename = safeFilename(record.title, record.contentType);
  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": record.contentType,
      "Content-Length": String(record.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});

fileRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const me = c.get("membership");
  const id = parseWith(idSchema, c.req.param("id"));
  const owner = await fileOwner(c.env, club.id, id);
  if (!owner) throw notFound("File not found");
  if (owner.ownerId !== user.id && !hasRole(me.role, "admin")) throw forbidden("Only the uploader or a club admin can delete this file");
  const banner = await c.env.DB.prepare("SELECT 1 FROM clubs WHERE id = ? AND banner_file_id = ?").bind(club.id, id).first();
  if (banner && !hasRole(me.role, "admin")) throw new ApiError(409, "file_in_use", "This image is the club banner. An admin can change the banner first.");
  await deleteFile(c.env, club.id, id);
  return c.json({ ok: true });
});
