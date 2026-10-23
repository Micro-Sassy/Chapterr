import type { MiddlewareHandler } from "hono";
import { CLUB_ROLES, type ClubRole } from "../../shared/constants";
import type { AppEnv, ClubRecord } from "../env";
import { bool, first } from "./db";
import { ApiError, forbidden, notFound } from "./errors";

interface ClubRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  plan: ClubRecord["plan"];
  billing_status: ClubRecord["billingStatus"];
  member_limit: number;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  role: ClubRole;
  joined_at: string;
  muted: number;
}

export function mapClubRecord(r: ClubRow): ClubRecord {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    plan: r.plan,
    billingStatus: r.billing_status,
    memberLimit: Number(r.member_limit),
    version: Number(r.version),
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Every club-scoped route (/api/clubs/:clubId/*) sits behind this middleware.
 * One query loads the club and the caller's membership together; a club the
 * caller is not a member of looks exactly like a club that does not exist
 * except for the error code, so nothing leaks about other clubs.
 */
export const requireClubMember: MiddlewareHandler<AppEnv> = async (c, next) => {
  const clubId = c.req.param("clubId");
  if (!clubId) throw notFound("Club not found");
  const user = c.get("user");
  const row = await first<ClubRow & { exists: number }>(
    c.env.DB,
    `SELECT c.id, c.name, c.slug, c.description, c.plan, c.billing_status, c.member_limit, c.version,
            c.created_by, c.updated_by, c.created_at, c.updated_at,
            m.role, m.joined_at, m.muted
       FROM clubs c
       LEFT JOIN club_members m ON m.club_id = c.id AND m.user_id = ?
      WHERE c.id = ? AND c.archived_at IS NULL`,
    user.id,
    clubId,
  );
  if (!row) throw notFound("Club not found");
  if (!row.role) throw new ApiError(403, "not_a_member", "You are not a member of this club");
  c.set("club", mapClubRecord(row));
  c.set("membership", { role: row.role, joinedAt: row.joined_at, muted: bool(row.muted) });
  await next();
};

const RANK: Record<ClubRole, number> = { owner: 3, admin: 2, member: 1 };

export function hasRole(role: ClubRole, atLeast: ClubRole): boolean {
  return RANK[role] >= RANK[atLeast];
}

/** Use after requireClubMember: `clubRoutes.put("/", requireClubRole("admin"), handler)`. */
export function requireClubRole(atLeast: ClubRole): MiddlewareHandler<AppEnv> {
  if (!CLUB_ROLES.includes(atLeast)) throw new Error(`Unknown role ${atLeast}`);
  return async (c, next) => {
    const membership = c.get("membership");
    if (!membership || !hasRole(membership.role, atLeast)) {
      throw forbidden(atLeast === "owner" ? "Only the club owner can do that" : "Only club admins can do that");
    }
    await next();
  };
}

/** True when two members share at least one (live) club. A member always "shares" with themselves. */
export async function sharesClubWith(db: D1Database, viewerId: string, ownerId: string): Promise<boolean> {
  if (viewerId === ownerId) return true;
  const row = await first<{ n: number }>(
    db,
    `SELECT 1 AS n FROM club_members a
       JOIN club_members b ON b.club_id = a.club_id AND b.user_id = ?
       JOIN clubs c ON c.id = a.club_id AND c.archived_at IS NULL
      WHERE a.user_id = ? LIMIT 1`,
    ownerId,
    viewerId,
  );
  return !!row;
}

/**
 * SQL fragment restricting a personal-content query to rows the viewer may
 * see: their own, or club-visible rows by members who share a club with them.
 * `alias` is the table alias carrying user_id and visibility. Binds: viewerId twice.
 */
export function visibleToViewerSql(alias: string): string {
  return `(${alias}.user_id = ? OR (${alias}.visibility = 'club' AND EXISTS (
      SELECT 1 FROM club_members va JOIN club_members vb ON vb.club_id = va.club_id
        JOIN clubs vc ON vc.id = va.club_id AND vc.archived_at IS NULL
       WHERE va.user_id = ? AND vb.user_id = ${alias}.user_id)))`;
}

/** SQL fragment: rows by members of the given club that the viewer may see. Binds: clubId, viewerId. */
export function visibleInClubSql(alias: string): string {
  return `EXISTS (SELECT 1 FROM club_members cm WHERE cm.club_id = ? AND cm.user_id = ${alias}.user_id)
          AND (${alias}.visibility = 'club' OR ${alias}.user_id = ?)`;
}

/** Ids of every live club the user belongs to (for realtime fan-out and permissions). */
export async function clubIdsFor(db: D1Database, userId: string): Promise<string[]> {
  const res = await db
    .prepare("SELECT m.club_id AS id FROM club_members m JOIN clubs c ON c.id = m.club_id AND c.archived_at IS NULL WHERE m.user_id = ?")
    .bind(userId)
    .all<{ id: string }>();
  return res.results.map((r) => r.id);
}

/** Member ids of a club (for notifications and realtime fan-out). */
export async function memberIdsOf(db: D1Database, clubId: string): Promise<string[]> {
  const res = await db.prepare("SELECT user_id FROM club_members WHERE club_id = ?").bind(clubId).all<{ user_id: string }>();
  return res.results.map((r) => r.user_id);
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Invite code: 10 unambiguous characters from a CSPRNG. */
export function newInviteCode(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
