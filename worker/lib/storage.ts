import { WAVE2_LIMITS, type FileKind } from "../../shared/constants";
import type { FileRecord, FileUsage } from "../../shared/types";
import type { Env } from "../env";
import { all, first } from "./db";
import { ApiError, badRequest, notFound } from "./errors";
import { mapMemberOrNull, memberCols, type Row } from "./mappers";
import { newId, nowIso } from "./util";

/**
 * Club file storage. Bytes live in the FILES R2 bucket when it is bound
 * (key `clubs/<clubId>/<fileId>`), otherwise inline in D1 `file_blobs`
 * (2 MB per file). Metadata always lives in `files`. Everything here is
 * club-scoped: every lookup binds the club id so a file id from another club
 * is indistinguishable from a missing one.
 */

/** Content types a club may upload. Anything executable in a browser (HTML, SVG, JS) is deliberately absent. */
export const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export const IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

/** Normalise a client content type ("image/jpeg; charset=..." → "image/jpeg", "image/jpg" → "image/jpeg"). */
export function normalizeContentType(raw: string | null | undefined): string {
  const base = (raw ?? "").split(";")[0]!.trim().toLowerCase();
  if (base === "image/jpg" || base === "image/pjpeg") return "image/jpeg";
  if (base === "text/md" || base === "text/x-markdown") return "text/markdown";
  return base;
}

export function storageMode(env: Env): "r2" | "d1" {
  return env.FILES ? "r2" : "d1";
}

export function perFileMax(env: Env): number {
  return env.FILES ? WAVE2_LIMITS.fileBytesMaxR2 : WAVE2_LIMITS.fileBytesMaxD1;
}

export function clubBytesMax(env: Env): number {
  return env.FILES ? WAVE2_LIMITS.clubStorageBytesMax : WAVE2_LIMITS.clubStorageBytesMaxD1;
}

export interface PutFileInput {
  clubId: string;
  ownerId: string;
  kind: FileKind;
  title: string | null;
  /** The original filename (used for the title fallback and the download name). */
  filename: string | null;
  contentType: string;
  bytes: Uint8Array;
  meetingId?: string | null;
}

/** Keep letters, digits, dots, dashes and underscores; everything else becomes "_". Never empty. */
export function safeFilename(title: string, contentType: string): string {
  const ext = EXTENSIONS[contentType];
  let base = title.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/^[._]+|[._]+$/g, "").slice(0, 80);
  if (!base) base = "file";
  if (ext && !base.toLowerCase().endsWith(`.${ext}`)) base = `${base}.${ext}`;
  return base;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function clubUsage(env: Env, clubId: string): Promise<FileUsage> {
  const row = await first<{ n: number; bytes: number | null }>(
    env.DB,
    "SELECT COUNT(*) AS n, SUM(size) AS bytes FROM files WHERE club_id = ? AND archived_at IS NULL",
    clubId,
  );
  return {
    files: Number(row?.n ?? 0),
    bytes: Number(row?.bytes ?? 0),
    filesMax: WAVE2_LIMITS.filesPerClub,
    bytesMax: clubBytesMax(env),
    perFileMax: perFileMax(env),
    storage: storageMode(env),
  };
}

/** Validate, enforce quotas and store a file. Returns the new record. */
export async function putFile(env: Env, input: PutFileInput): Promise<FileRecord> {
  const contentType = normalizeContentType(input.contentType);
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new ApiError(415, "unsupported_type", "That file type is not supported. Upload an image, PDF, text or Office document.");
  }
  if (input.bytes.byteLength === 0) throw badRequest("The file is empty");
  const max = perFileMax(env);
  if (input.bytes.byteLength > max) {
    throw new ApiError(413, "file_too_large", `Files must be ${Math.floor(max / 1_000_000)} MB or smaller`);
  }
  if ((input.kind === "banner" || input.kind === "photo") && !IMAGE_CONTENT_TYPES.has(contentType)) {
    throw new ApiError(415, "unsupported_type", input.kind === "banner" ? "Banners must be images" : "Photos must be images");
  }
  const usage = await clubUsage(env, input.clubId);
  if (usage.files >= usage.filesMax) {
    throw new ApiError(409, "quota_exceeded", `This club has reached its limit of ${usage.filesMax} files. Delete some files first.`);
  }
  if (usage.bytes + input.bytes.byteLength > usage.bytesMax) {
    throw new ApiError(409, "quota_exceeded", "This club has used all of its storage. Delete some files first.");
  }
  const id = newId();
  const now = nowIso();
  const title = (input.title ?? "").trim() || (input.filename ?? "").trim() || `${input.kind} ${now.slice(0, 10)}`;
  const hash = await sha256(input.bytes);
  const storage = storageMode(env);
  const r2Key = storage === "r2" ? `clubs/${input.clubId}/${id}` : null;
  if (storage === "r2") {
    await env.FILES!.put(r2Key!, input.bytes as unknown as ArrayBuffer, {
      httpMetadata: { contentType },
      customMetadata: { clubId: input.clubId, ownerId: input.ownerId, kind: input.kind },
      sha256: hash,
    });
  }
  const stmts = [
    env.DB.prepare(
      `INSERT INTO files (id, club_id, owner_id, kind, title, content_type, size, storage, r2_key, meeting_id, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, input.clubId, input.ownerId, input.kind, title.slice(0, 120), contentType, input.bytes.byteLength, storage, r2Key, input.meetingId ?? null, hash, now),
  ];
  if (storage === "d1") stmts.push(env.DB.prepare("INSERT INTO file_blobs (file_id, data) VALUES (?, ?)").bind(id, input.bytes));
  try {
    await env.DB.batch(stmts);
  } catch (err) {
    if (r2Key) await env.FILES!.delete(r2Key).catch(() => undefined);
    throw err;
  }
  const record = await loadFile(env, input.clubId, id);
  if (!record) throw new ApiError(500, "server_error", "Could not store the file");
  return record;
}

export const FILE_SELECT = `SELECT f.id, f.club_id, f.kind, f.title, f.content_type, f.size, f.meeting_id, f.created_at, f.owner_id, ${memberCols("u", "o_")}
  FROM files f LEFT JOIN "user" u ON u.id = f.owner_id`;

export function fileUrl(clubId: string, fileId: string): string {
  return `/api/clubs/${clubId}/files/${fileId}/content`;
}

export function mapFile(r: Row): FileRecord {
  const clubId = String(r.club_id);
  return {
    id: String(r.id),
    clubId,
    kind: r.kind as FileKind,
    title: String(r.title),
    contentType: String(r.content_type),
    size: Number(r.size),
    meetingId: (r.meeting_id as string | null) ?? null,
    url: fileUrl(clubId, String(r.id)),
    owner: mapMemberOrNull(r, "o_"),
    createdAt: String(r.created_at),
  };
}

export async function loadFile(env: Env, clubId: string, fileId: string): Promise<FileRecord | null> {
  const r = await first<Row>(env.DB, `${FILE_SELECT} WHERE f.id = ? AND f.club_id = ? AND f.archived_at IS NULL`, fileId, clubId);
  return r ? mapFile(r) : null;
}

/** Owner id of a live file in this club (for permission checks). */
export async function fileOwner(env: Env, clubId: string, fileId: string): Promise<{ ownerId: string | null; kind: FileKind } | null> {
  const r = await first<{ owner_id: string | null; kind: FileKind }>(
    env.DB,
    "SELECT owner_id, kind FROM files WHERE id = ? AND club_id = ? AND archived_at IS NULL",
    fileId,
    clubId,
  );
  return r ? { ownerId: r.owner_id, kind: r.kind } : null;
}

export interface FileContent {
  record: FileRecord;
  body: ReadableStream | Uint8Array;
}

/** D1 returns BLOB columns as an ArrayBuffer or, depending on the driver, a plain number array. */
function toBytes(data: ArrayBuffer | number[] | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return Uint8Array.from(data);
  return new Uint8Array(data);
}

/** The bytes of a file. R2 objects stream; D1 blobs are returned whole. */
export async function getFile(env: Env, clubId: string, fileId: string): Promise<FileContent | null> {
  const row = await first<Row & { storage: string; r2_key: string | null }>(
    env.DB,
    `SELECT f.storage, f.r2_key, f.id, f.club_id, f.kind, f.title, f.content_type, f.size, f.meeting_id, f.created_at, f.owner_id, ${memberCols("u", "o_")}
       FROM files f LEFT JOIN "user" u ON u.id = f.owner_id WHERE f.id = ? AND f.club_id = ? AND f.archived_at IS NULL`,
    fileId,
    clubId,
  );
  if (!row) return null;
  const record = mapFile(row);
  if (row.storage === "r2") {
    if (!env.FILES || !row.r2_key) throw new ApiError(503, "storage_unavailable", "File storage is not available right now");
    const obj = await env.FILES.get(row.r2_key);
    if (!obj) return null;
    return { record, body: obj.body };
  }
  const blob = await first<{ data: ArrayBuffer | number[] | Uint8Array }>(env.DB, "SELECT data FROM file_blobs WHERE file_id = ?", fileId);
  if (!blob) return null;
  return { record, body: toBytes(blob.data) };
}

/** Remove a file and its bytes. Clears any club banner that pointed at it. */
export async function deleteFile(env: Env, clubId: string, fileId: string): Promise<void> {
  const row = await first<{ storage: string; r2_key: string | null }>(
    env.DB,
    "SELECT storage, r2_key FROM files WHERE id = ? AND club_id = ?",
    fileId,
    clubId,
  );
  if (!row) throw notFound("File not found");
  await env.DB.batch([
    env.DB.prepare("UPDATE clubs SET banner_file_id = NULL WHERE id = ? AND banner_file_id = ?").bind(clubId, fileId),
    env.DB.prepare("DELETE FROM file_blobs WHERE file_id = ?").bind(fileId),
    env.DB.prepare("DELETE FROM files WHERE id = ? AND club_id = ?").bind(fileId, clubId),
  ]);
  if (row.storage === "r2" && row.r2_key && env.FILES) {
    await env.FILES.delete(row.r2_key).catch((err: unknown) => console.error("r2 delete failed", err instanceof Error ? err.message : err));
  }
}

/** Files of a club in one query (used by the list route). */
export async function listFiles(env: Env, clubId: string, where: string, params: (string | number)[], limit: number): Promise<FileRecord[]> {
  const rows = await all<Row>(
    env.DB,
    `${FILE_SELECT} WHERE f.club_id = ? AND f.archived_at IS NULL ${where} ORDER BY f.created_at DESC, f.id DESC LIMIT ${limit}`,
    clubId,
    ...params,
  );
  return rows.map(mapFile);
}
