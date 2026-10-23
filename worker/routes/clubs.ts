import { Hono, type Context } from "hono";
import { CLUB_PRICE_CENTS, LIMITS, type ClubRole } from "../../shared/constants";
import {
  clubCreateSchema,
  clubUpdateSchema,
  deleteClubSchema,
  idSchema,
  inviteCodeSchema,
  inviteCreateSchema,
  joinAnswersSchema,
  memberRoleSchema,
  transferOwnershipSchema,
} from "../../shared/schemas";
import type {
  Club,
  ClubBilling,
  ClubBranding,
  ClubInvite,
  ClubMember,
  ClubSummary,
  InvitePreview,
  InvitePreviewExtras,
  JoinPending,
  MyJoinRequest,
  ScreeningQuestion,
} from "../../shared/types";
import { getAuth } from "../auth/auth";
import { createEmailProvider } from "../email";
import { joinRequestEmail } from "../email/templates";
import type { AppEnv, Env } from "../env";
import { newInviteCode, requireClubRole } from "../lib/club";
import { confirmPassword } from "../lib/confirm";
import { all, first, run } from "../lib/db";
import { ApiError, badRequest, forbidden, notFound } from "../lib/errors";
import { parseBody, parseWith } from "../lib/http";
import { mapMember, mapMemberOrNull, memberCols, type Row } from "../lib/mappers";
import { notifyUsers } from "../lib/notify";
import { fileUrl } from "../lib/storage";
import { newId, nowIso, slugify } from "../lib/util";
import { postWelcome } from "../lib/welcome";
import { updateVersioned } from "../lib/versioned";
import { disconnectUserFromClub, publish } from "../realtime/publish";
import { enforceRateLimit } from "../security/rate-limit";
import { clientIp, requireTurnstile } from "../security/turnstile";

/**
 * Clubs: creation, joining by invite code, membership and roles, invites,
 * archiving. `clubsRoutes` is mounted at /api/clubs (no club context);
 * `clubAdminRoutes` at /api/clubs/:clubId behind requireClubMember.
 */
export const clubsRoutes = new Hono<AppEnv>();
export const clubAdminRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

const CLUB_SELECT = `SELECT c.id, c.name, c.slug, c.description, c.plan, c.billing_status, c.member_limit, c.version, c.created_at, c.updated_at,
    c.banner_file_id, c.accent_color, m.role, m.joined_at,
    (SELECT COUNT(*) FROM club_members x WHERE x.club_id = c.id) AS member_count,
    ${memberCols("o", "o_")}
  FROM clubs c
  JOIN club_members m ON m.club_id = c.id AND m.user_id = ?
  LEFT JOIN club_members om ON om.club_id = c.id AND om.role = 'owner'
  LEFT JOIN "user" o ON o.id = om.user_id`;

function mapSummary(r: Row): ClubSummary {
  return {
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    description: (r.description as string | null) ?? null,
    role: r.role as ClubRole,
    memberCount: Number(r.member_count ?? 0),
    plan: r.plan as ClubSummary["plan"],
    createdAt: String(r.created_at),
    joinedAt: String(r.joined_at),
  };
}

/** A club with its branding (wave 2): the banner URL and accent colour, for the club header. */
export type ClubWithBranding = Club & { branding: ClubBranding };

export function mapBranding(r: Row): ClubBranding {
  const clubId = String(r.id);
  const bannerFileId = (r.banner_file_id as string | null) ?? null;
  return { bannerUrl: bannerFileId ? fileUrl(clubId, bannerFileId) : null, accentColor: (r.accent_color as string | null) ?? null };
}

function mapClub(r: Row): ClubWithBranding {
  return {
    ...mapSummary(r),
    memberLimit: Number(r.member_limit),
    billingStatus: r.billing_status as Club["billingStatus"],
    version: Number(r.version),
    owner: mapMemberOrNull(r, "o_"),
    updatedAt: String(r.updated_at),
    branding: mapBranding(r),
  };
}

/** Parse clubs.screening_questions (JSON) defensively. */
export function parseScreeningQuestions(raw: unknown): ScreeningQuestion[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
      .map((q) => ({ id: String(q.id ?? ""), label: String(q.label ?? ""), required: q.required !== false }))
      .filter((q) => q.id && q.label);
  } catch {
    return [];
  }
}

/** The club as seen by one of its members (null when archived or not a member). */
export async function loadClub(db: D1Database, clubId: string, viewerId: string): Promise<ClubWithBranding | null> {
  const r = await first<Row>(db, `${CLUB_SELECT} WHERE c.id = ? AND c.archived_at IS NULL`, viewerId, clubId);
  return r ? mapClub(r) : null;
}

/** Every live club the member belongs to, most recently joined first. */
export async function loadClubSummaries(db: D1Database, userId: string): Promise<ClubSummary[]> {
  const rows = await all<Row>(db, `${CLUB_SELECT} WHERE c.archived_at IS NULL ORDER BY m.joined_at DESC, c.name COLLATE NOCASE`, userId);
  return rows.map(mapSummary);
}

async function requireClub(c: Context<AppEnv>, viewerId: string): Promise<ClubWithBranding> {
  const club = await loadClub(c.env.DB, c.get("club").id, viewerId);
  if (!club) throw notFound("Club not found");
  return club;
}

const MEMBER_SELECT = `SELECT ${memberCols("u", "m_")}, m.role, m.joined_at FROM club_members m JOIN "user" u ON u.id = m.user_id`;

function mapClubMember(r: Row): ClubMember {
  return { ...mapMember(r, "m_"), role: r.role as ClubRole, joinedAt: String(r.joined_at) };
}

async function loadMembership(db: D1Database, clubId: string, userId: string): Promise<ClubMember | null> {
  const r = await first<Row>(db, `${MEMBER_SELECT} WHERE m.club_id = ? AND m.user_id = ?`, clubId, userId);
  return r ? mapClubMember(r) : null;
}

// ---------------------------------------------------------------------------
// Membership changes shared by join / leave / remove / archive
// ---------------------------------------------------------------------------

/**
 * Statements that end a membership: the club_members row and every
 * conversation participation inside that club (main chat and direct chats).
 */
function endMembershipStatements(env: Env, clubId: string, userId: string): D1PreparedStatement[] {
  return [
    env.DB.prepare("DELETE FROM club_members WHERE club_id = ? AND user_id = ?").bind(clubId, userId),
    env.DB.prepare(
      "DELETE FROM conversation_participants WHERE user_id = ? AND conversation_id IN (SELECT id FROM conversations WHERE club_id = ?)",
    ).bind(userId, clubId),
    env.DB.prepare("UPDATE profiles SET last_club_id = NULL WHERE user_id = ? AND last_club_id = ?").bind(userId, clubId),
  ];
}

/** Tell the member's open sockets on this club that the membership ended, then close them. */
async function endRealtime(env: Env, clubId: string, userId: string): Promise<void> {
  await publish(env, clubId, [userId], { type: "membership.ended", clubId });
  await disconnectUserFromClub(env, clubId, userId);
}

async function mainConversationId(db: D1Database, clubId: string): Promise<string | null> {
  const row = await first<{ id: string }>(db, "SELECT id FROM conversations WHERE club_id = ? AND kind = 'club'", clubId);
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

interface InviteRow {
  id: string;
  club_id: string;
  code: string;
  created_by: string | null;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  revoked_at: string | null;
  created_at: string;
}

type InviteState = "live" | "revoked" | "expired" | "exhausted";

function inviteState(i: InviteRow, now = nowIso()): InviteState {
  if (i.revoked_at) return "revoked";
  if (i.expires_at && i.expires_at <= now) return "expired";
  if (i.max_uses !== null && Number(i.use_count) >= Number(i.max_uses)) return "exhausted";
  return "live";
}

const LIVE_INVITE_SQL = "i.revoked_at IS NULL AND (i.expires_at IS NULL OR i.expires_at > ?) AND (i.max_uses IS NULL OR i.use_count < i.max_uses)";

function joinUrl(env: Env, code: string): string {
  return `${env.PUBLIC_APP_URL.replace(/\/+$/, "")}/join/${code}`;
}

function mapInvite(env: Env, r: Row): ClubInvite {
  return {
    id: String(r.id),
    code: String(r.code),
    url: joinUrl(env, String(r.code)),
    createdBy: mapMemberOrNull(r, "cb_"),
    expiresAt: (r.expires_at as string | null) ?? null,
    maxUses: r.max_uses === null || r.max_uses === undefined ? null : Number(r.max_uses),
    useCount: Number(r.use_count ?? 0),
    revokedAt: (r.revoked_at as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

const INVITE_SELECT = `SELECT i.*, ${memberCols("cb", "cb_")} FROM club_invites i LEFT JOIN "user" cb ON cb.id = i.created_by`;

/**
 * Public invite preview: what a visitor sees before accepting. Works without a
 * session; with one, says whether the viewer already belongs. Revoked or
 * unknown codes are indistinguishable (404). Never lists members.
 */
export async function invitePreview(c: Context<AppEnv>): Promise<Response> {
  await enforceRateLimit(c.env, "invite-preview", clientIp(c.req.raw) ?? "unknown", { window: 60, max: 30 });
  const code = parseWith(inviteCodeSchema, c.req.param("code") ?? "");
  const row = await first<
    InviteRow & {
      name: string;
      description: string | null;
      archived_at: string | null;
      member_count: number;
      invited_by: string | null;
      join_policy: "link" | "approval";
      screening_questions: string;
    }
  >(
    c.env.DB,
    `SELECT i.*, c.name, c.description, c.archived_at, c.join_policy, c.screening_questions, u.name AS invited_by,
            (SELECT COUNT(*) FROM club_members x WHERE x.club_id = c.id) AS member_count
       FROM club_invites i JOIN clubs c ON c.id = i.club_id LEFT JOIN "user" u ON u.id = i.created_by
      WHERE i.code = ?`,
    code,
  );
  if (!row || row.archived_at || row.revoked_at) throw notFound("This invite link is not valid.");
  let alreadyMember = false;
  if (c.req.header("cookie")) {
    const session = await getAuth(c.env).api.getSession({ headers: c.req.raw.headers });
    if (session?.user.emailVerified) {
      alreadyMember = !!(await first(c.env.DB, "SELECT 1 FROM club_members WHERE club_id = ? AND user_id = ?", row.club_id, session.user.id));
    }
  }
  const preview: InvitePreview & InvitePreviewExtras = {
    code,
    club: { id: row.club_id, name: row.name, description: row.description, memberCount: Number(row.member_count ?? 0) },
    invitedBy: row.invited_by ?? null,
    alreadyMember,
    expired: inviteState(row) !== "live",
    joinPolicy: row.join_policy === "approval" ? "approval" : "link",
    screeningQuestions: row.join_policy === "approval" ? parseScreeningQuestions(row.screening_questions) : [],
  };
  c.header("Cache-Control", "no-store");
  return c.json(preview);
}

// ---------------------------------------------------------------------------
// /api/clubs — list, create, join
// ---------------------------------------------------------------------------

clubsRoutes.get("/", async (c) => c.json(await loadClubSummaries(c.env.DB, c.get("user").id)));

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function slugFor(name: string): string {
  const base = slugify(name).slice(0, 40).replace(/-+$/, "") || "club";
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `${base}-${Array.from(bytes, (b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join("")}`;
}

clubsRoutes.post("/", async (c) => {
  const user = c.get("user");
  await requireTurnstile(c.env, c.req.header("x-turnstile-token"), clientIp(c.req.raw));
  await enforceRateLimit(c.env, "club-create", user.id, { window: 60 * 60, max: 5 });
  const input = await parseBody(c, clubCreateSchema);
  const counts = await first<{ owned: number; total: number }>(
    c.env.DB,
    `SELECT SUM(CASE WHEN m.role = 'owner' THEN 1 ELSE 0 END) AS owned, COUNT(*) AS total
       FROM club_members m JOIN clubs c ON c.id = m.club_id AND c.archived_at IS NULL WHERE m.user_id = ?`,
    user.id,
  );
  if (Number(counts?.owned ?? 0) >= LIMITS.clubsOwnedMax) {
    throw new ApiError(409, "limit_reached", `You can own up to ${LIMITS.clubsOwnedMax} clubs.`);
  }
  if (Number(counts?.total ?? 0) >= LIMITS.clubsPerUserMax) {
    throw new ApiError(409, "limit_reached", `You can belong to up to ${LIMITS.clubsPerUserMax} clubs.`);
  }
  const id = newId();
  const conversationId = newId();
  const now = nowIso();
  // The club, the owner's membership and the club's main conversation are created together.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = slugFor(input.name);
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO clubs (id, name, description, slug, plan, member_limit, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'beta_free', ?, ?, ?, ?, ?)`,
        ).bind(id, input.name, input.description, slug, LIMITS.clubMembersMax, user.id, user.id, now, now),
        c.env.DB.prepare("INSERT INTO club_members (club_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").bind(id, user.id, now),
        c.env.DB.prepare("INSERT INTO conversations (id, club_id, kind, created_at) VALUES (?, ?, 'club', ?)").bind(conversationId, id, now),
        c.env.DB.prepare("INSERT INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").bind(conversationId, user.id, now),
        c.env.DB.prepare("UPDATE profiles SET last_club_id = ?, updated_at = ? WHERE user_id = ?").bind(id, now, user.id),
      ]);
      break;
    } catch (err) {
      if (attempt === 4 || !/UNIQUE/i.test(err instanceof Error ? err.message : String(err))) throw err;
    }
  }
  const club = await loadClub(c.env.DB, id, user.id);
  return c.json(club, 201);
});

// ---------------------------------------------------------------------------
// Joining: shared by the invite flow here and join-request approval (membership.ts)
// ---------------------------------------------------------------------------

/** 409 when the member or the club is at its limit. */
export async function assertCanJoin(env: Env, clubId: string, userId: string, memberLimit: number): Promise<void> {
  const [mine, size] = await Promise.all([
    first<{ n: number }>(
      env.DB,
      "SELECT COUNT(*) AS n FROM club_members m JOIN clubs c ON c.id = m.club_id AND c.archived_at IS NULL WHERE m.user_id = ?",
      userId,
    ),
    first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM club_members WHERE club_id = ?", clubId),
  ]);
  if (Number(mine?.n ?? 0) >= LIMITS.clubsPerUserMax) {
    throw new ApiError(409, "limit_reached", `You can belong to up to ${LIMITS.clubsPerUserMax} clubs.`);
  }
  if (Number(size?.n ?? 0) >= Number(memberLimit)) throw new ApiError(409, "club_full", "This club has reached its member limit.");
}

/**
 * Statements that make `userId` a member: the club_members row, a seat in
 * the main conversation, the invite's use count / accepted_by, and the
 * member's "last club" pointer.
 */
export async function joinStatements(env: Env, clubId: string, userId: string, inviteId: string | null, now = nowIso()): Promise<D1PreparedStatement[]> {
  const conversationId = await mainConversationId(env.DB, clubId);
  return [
    env.DB.prepare("INSERT OR IGNORE INTO club_members (club_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").bind(clubId, userId, now),
    ...(conversationId
      ? [env.DB.prepare("INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, joined_at) VALUES (?, ?, ?)").bind(conversationId, userId, now)]
      : []),
    ...(inviteId
      ? [
          env.DB.prepare("UPDATE club_invites SET use_count = use_count + 1, accepted_by = CASE WHEN email IS NOT NULL THEN ? ELSE accepted_by END WHERE id = ?").bind(
            userId,
            inviteId,
          ),
        ]
      : []),
    env.DB.prepare("UPDATE profiles SET last_club_id = ?, updated_at = ? WHERE user_id = ?").bind(clubId, now, userId),
  ];
}

/** After a membership row exists: tell admins, refresh clients and post the welcome message. Best effort. */
export async function afterJoin(env: Env, club: { id: string; name: string }, userId: string, userName: string, actorId: string): Promise<void> {
  const admins = await all<{ user_id: string }>(env.DB, "SELECT user_id FROM club_members WHERE club_id = ? AND role IN ('owner', 'admin')", club.id);
  await Promise.allSettled([
    notifyUsers(
      env,
      admins.map((a) => a.user_id),
      { kind: "club_member_joined", clubId: club.id, title: `${userName} joined ${club.name}`, link: `/c/${club.id}/members`, actorId },
    ),
    publish(env, club.id, "all", { type: "club.updated", clubId: club.id }),
    postWelcome(env, club.id, userId).catch((err: unknown) => console.error("welcome message failed", err instanceof Error ? err.message : err)),
  ]);
}

interface JoinInviteRow extends InviteRow {
  archived_at: string | null;
  member_limit: number;
  club_name: string;
  join_policy: "link" | "approval";
  screening_questions: string;
}

/**
 * Join with an invite code. Clubs with `join_policy = 'approval'` get a join
 * request instead (202): admins are notified and emailed, and the member is
 * added when an admin approves (membership.ts).
 */
clubsRoutes.post("/join", async (c) => {
  const user = c.get("user");
  await requireTurnstile(c.env, c.req.header("x-turnstile-token"), clientIp(c.req.raw));
  await enforceRateLimit(c.env, "club-join", user.id, { window: 60 * 60, max: 10 });
  await enforceRateLimit(c.env, "club-join-ip", clientIp(c.req.raw) ?? "unknown", { window: 60 * 60, max: 30 });
  const input = await parseBody(c, joinAnswersSchema);
  const code = parseWith(inviteCodeSchema, input.code);
  const invite = await first<JoinInviteRow>(
    c.env.DB,
    `SELECT i.*, c.archived_at, c.member_limit, c.name AS club_name, c.join_policy, c.screening_questions
       FROM club_invites i JOIN clubs c ON c.id = i.club_id WHERE i.code = ?`,
    code,
  );
  if (!invite || invite.archived_at || invite.revoked_at) throw new ApiError(404, "invite_invalid", "That invite link is not valid.");
  const existing = await loadClub(c.env.DB, invite.club_id, user.id);
  if (existing) return c.json(existing, 200);
  const state = inviteState(invite);
  if (state === "expired") throw new ApiError(410, "invite_expired", "That invite link has expired. Ask a club admin for a new one.");
  if (state === "exhausted") throw new ApiError(410, "invite_expired", "That invite link has been used up. Ask a club admin for a new one.");
  await assertCanJoin(c.env, invite.club_id, user.id, invite.member_limit);
  const now = nowIso();

  if (invite.join_policy === "approval") {
    const questions = parseScreeningQuestions(invite.screening_questions);
    const answers = questions.map((q) => ({
      questionId: q.id,
      label: q.label,
      answer: input.answers.find((a) => a.questionId === q.id)?.answer.trim() ?? "",
    }));
    const missing = answers.filter((a, i) => questions[i]!.required && !a.answer);
    if (missing.length) {
      throw new ApiError(422, "validation_error", "Please answer every required question", {
        fields: Object.fromEntries(missing.map((m) => [m.questionId, ["Required"]])),
      });
    }
    const pending = await first<{ id: string; status: string }>(c.env.DB, "SELECT id, status FROM join_requests WHERE club_id = ? AND user_id = ?", invite.club_id, user.id);
    if (pending?.status === "pending") {
      return c.json({ pending: true, requestId: pending.id, clubName: invite.club_name } satisfies JoinPending, 202);
    }
    const requestId = pending?.id ?? newId();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO join_requests (id, club_id, user_id, invite_id, answers, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT (club_id, user_id) DO UPDATE SET invite_id = excluded.invite_id, answers = excluded.answers, message = excluded.message,
           status = 'pending', decided_by = NULL, decided_at = NULL, created_at = excluded.created_at`,
      ).bind(requestId, invite.club_id, user.id, invite.id, JSON.stringify(answers), input.message, now),
      // The code is spent now so a single-use email invite cannot be reused while the request waits.
      c.env.DB.prepare("UPDATE club_invites SET use_count = use_count + 1 WHERE id = ?").bind(invite.id),
    ]);
    const admins = await all<{ user_id: string; email: string; name: string }>(
      c.env.DB,
      `SELECT m.user_id, u.email, u.name FROM club_members m JOIN "user" u ON u.id = m.user_id WHERE m.club_id = ? AND m.role IN ('owner', 'admin')`,
      invite.club_id,
    );
    const link = `/c/${invite.club_id}/members?tab=requests`;
    c.executionCtx.waitUntil(
      (async () => {
        await notifyUsers(
          c.env,
          admins.map((a) => a.user_id),
          {
            kind: "join_request",
            clubId: invite.club_id,
            title: `${user.name} asked to join ${invite.club_name}`,
            body: input.message,
            link,
            actorId: user.id,
          },
        );
        let provider;
        try {
          provider = createEmailProvider(c.env);
        } catch (err) {
          console.error("join request email skipped:", err instanceof Error ? err.message : err);
          return;
        }
        const url = `${c.env.PUBLIC_APP_URL.replace(/\/+$/, "")}${link}`;
        for (const a of admins) {
          try {
            await provider.send(joinRequestEmail(a.email, a.name, invite.club_name, user.name, answers, url));
          } catch (err) {
            console.error("join request email failed", err instanceof Error ? err.message : err);
          }
        }
      })(),
    );
    return c.json({ pending: true, requestId, clubName: invite.club_name } satisfies JoinPending, 202);
  }

  await c.env.DB.batch(await joinStatements(c.env, invite.club_id, user.id, invite.id, now));
  const club = await loadClub(c.env.DB, invite.club_id, user.id);
  if (!club) throw new ApiError(500, "server_error", "Could not join the club");
  c.executionCtx.waitUntil(afterJoin(c.env, club, user.id, user.name, user.id));
  return c.json(club, 201);
});

// --- The member's own join requests ---------------------------------------------------

const MY_REQUEST_SELECT = `SELECT r.id, r.status, r.created_at, r.decided_at, c.id AS club_id, c.name AS club_name
  FROM join_requests r JOIN clubs c ON c.id = r.club_id WHERE r.user_id = ? AND c.archived_at IS NULL`;

function mapMyRequest(r: Row): MyJoinRequest {
  return {
    id: String(r.id),
    club: { id: String(r.club_id), name: String(r.club_name) },
    status: r.status as MyJoinRequest["status"],
    createdAt: String(r.created_at),
    decidedAt: (r.decided_at as string | null) ?? null,
  };
}

clubsRoutes.get("/requests", async (c) => {
  const rows = await all<Row>(c.env.DB, `${MY_REQUEST_SELECT} ORDER BY r.created_at DESC LIMIT 50`, c.get("user").id);
  return c.json(rows.map(mapMyRequest) satisfies MyJoinRequest[]);
});

/** Withdraw a pending request. Decided requests stay as a record. */
clubsRoutes.delete("/requests/:id", async (c) => {
  const user = c.get("user");
  const id = parseWith(idSchema, c.req.param("id"));
  const res = await run(c.env.DB, "DELETE FROM join_requests WHERE id = ? AND user_id = ? AND status = 'pending'", id, user.id);
  if (res.meta.changes === 0) throw notFound("Request not found");
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// /api/clubs/:clubId — behind requireClubMember
// ---------------------------------------------------------------------------

clubAdminRoutes.get("/", async (c) => c.json(await requireClub(c, c.get("user").id)));

clubAdminRoutes.put("/", requireClubRole("admin"), async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const input = await parseBody(c, clubUpdateSchema);
  const updated = await updateVersioned({
    db: c.env.DB,
    table: "clubs",
    id: club.id,
    expectedVersion: input.expectedVersion,
    userId: user.id,
    label: "Club",
    set: { name: input.name, description: input.description },
    load: () => loadClub(c.env.DB, club.id, user.id),
  });
  c.executionCtx.waitUntil(publish(c.env, club.id, "all", { type: "club.updated", clubId: club.id }));
  return c.json(updated);
});

clubAdminRoutes.get("/members", async (c) => {
  const rows = await all<Row>(
    c.env.DB,
    `${MEMBER_SELECT} WHERE m.club_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name COLLATE NOCASE`,
    c.get("club").id,
  );
  return c.json(rows.map(mapClubMember) satisfies ClubMember[]);
});

clubAdminRoutes.put("/members/:userId/role", requireClubRole("admin"), async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const me = c.get("membership");
  const targetId = parseWith(idSchema, c.req.param("userId"));
  const { role } = await parseBody(c, memberRoleSchema);
  const target = await loadMembership(c.env.DB, club.id, targetId);
  if (!target) throw notFound("Member not found");
  if (target.role === "owner") throw forbidden("The owner's role cannot be changed. Transfer ownership instead.");
  if (target.role === "admin" && me.role !== "owner") throw forbidden("Only the club owner can change another admin's role");
  if (target.role !== role) {
    await run(c.env.DB, "UPDATE club_members SET role = ? WHERE club_id = ? AND user_id = ? AND role <> 'owner'", role, club.id, targetId);
    c.executionCtx.waitUntil(
      Promise.all([
        notifyUsers(c.env, [targetId], {
          kind: "club_role_changed",
          clubId: club.id,
          title: role === "admin" ? `You are now an admin of ${club.name}` : `You are now a member of ${club.name}`,
          link: `/c/${club.id}`,
          actorId: user.id,
        }),
        publish(c.env, club.id, "all", { type: "club.updated", clubId: club.id }),
      ]),
    );
  }
  const updated = await loadMembership(c.env.DB, club.id, targetId);
  return c.json(updated);
});

clubAdminRoutes.delete("/members/:userId", requireClubRole("admin"), async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const me = c.get("membership");
  const targetId = parseWith(idSchema, c.req.param("userId"));
  if (targetId === user.id) throw badRequest("Use “Leave club” to remove yourself");
  const target = await loadMembership(c.env.DB, club.id, targetId);
  if (!target) throw notFound("Member not found");
  if (target.role === "owner") throw forbidden("The club owner cannot be removed");
  if (target.role === "admin" && me.role !== "owner") throw forbidden("Only the club owner can remove an admin");
  await c.env.DB.batch(endMembershipStatements(c.env, club.id, targetId));
  c.executionCtx.waitUntil(
    Promise.all([
      endRealtime(c.env, club.id, targetId),
      notifyUsers(c.env, [targetId], {
        kind: "club_removed",
        clubId: club.id,
        title: `You were removed from ${club.name}`,
        link: "/",
        actorId: user.id,
      }),
      publish(c.env, club.id, "all", { type: "club.updated", clubId: club.id }),
    ]),
  );
  return c.json({ ok: true });
});

clubAdminRoutes.post("/leave", async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const me = c.get("membership");
  if (me.role === "owner") {
    throw new ApiError(409, "owner_must_transfer", "Transfer ownership to another member before leaving, or delete the club.");
  }
  await c.env.DB.batch(endMembershipStatements(c.env, club.id, user.id));
  c.executionCtx.waitUntil(
    Promise.all([endRealtime(c.env, club.id, user.id), publish(c.env, club.id, "all", { type: "club.updated", clubId: club.id })]),
  );
  return c.json({ ok: true });
});

clubAdminRoutes.post("/transfer-ownership", requireClubRole("owner"), async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const input = await parseBody(c, transferOwnershipSchema);
  await confirmPassword(c, user.id, input.currentPassword);
  if (input.userId === user.id) throw badRequest("You already own this club");
  const target = await loadMembership(c.env.DB, club.id, input.userId);
  if (!target) throw notFound("Member not found");
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE club_members SET role = 'admin' WHERE club_id = ? AND user_id = ? AND role = 'owner'").bind(club.id, user.id),
    c.env.DB.prepare("UPDATE club_members SET role = 'owner' WHERE club_id = ? AND user_id = ?").bind(club.id, input.userId),
    c.env.DB.prepare("UPDATE clubs SET updated_by = ?, updated_at = ? WHERE id = ?").bind(user.id, now, club.id),
  ]);
  c.executionCtx.waitUntil(
    Promise.all([
      notifyUsers(c.env, [input.userId], {
        kind: "club_role_changed",
        clubId: club.id,
        title: `You are now the owner of ${club.name}`,
        link: `/c/${club.id}/settings`,
        actorId: user.id,
      }),
      publish(c.env, club.id, "all", { type: "club.updated", clubId: club.id }),
    ]),
  );
  return c.json(await loadClub(c.env.DB, club.id, user.id));
});

/** Archive the club. It disappears for everyone at once; the daily cron purges the data after 30 days. */
clubAdminRoutes.post("/delete", requireClubRole("owner"), async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  const input = await parseBody(c, deleteClubSchema);
  await confirmPassword(c, user.id, input.currentPassword);
  if (input.confirmName.trim() !== club.name) {
    throw badRequest("Type the club's name exactly to confirm", { confirmName: ["Does not match the club name"] });
  }
  const members = await all<{ user_id: string }>(c.env.DB, "SELECT user_id FROM club_members WHERE club_id = ?", club.id);
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE clubs SET archived_at = ?, updated_by = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL").bind(now, user.id, now, club.id),
    c.env.DB.prepare("UPDATE club_invites SET revoked_at = COALESCE(revoked_at, ?) WHERE club_id = ?").bind(now, club.id),
    c.env.DB.prepare("UPDATE share_links SET revoked_at = COALESCE(revoked_at, ?) WHERE club_id = ?").bind(now, club.id),
    c.env.DB.prepare("UPDATE profiles SET last_club_id = NULL WHERE last_club_id = ?").bind(club.id),
  ]);
  c.executionCtx.waitUntil(
    (async () => {
      await publish(c.env, club.id, "all", { type: "membership.ended", clubId: club.id });
      await Promise.all(members.map((m) => disconnectUserFromClub(c.env, club.id, m.user_id)));
    })(),
  );
  return c.json({ ok: true });
});

// --- Invites ------------------------------------------------------------------

clubAdminRoutes.get("/invites", requireClubRole("admin"), async (c) => {
  const now = nowIso();
  const rows = await all<Row>(
    c.env.DB,
    `${INVITE_SELECT} WHERE i.club_id = ? ORDER BY CASE WHEN ${LIVE_INVITE_SQL} THEN 0 ELSE 1 END, i.created_at DESC LIMIT 100`,
    c.get("club").id,
    now,
  );
  return c.json(rows.map((r) => mapInvite(c.env, r)) satisfies ClubInvite[]);
});

clubAdminRoutes.post("/invites", requireClubRole("admin"), async (c) => {
  const user = c.get("user");
  const club = c.get("club");
  await enforceRateLimit(c.env, "invite-create", club.id, { window: 60 * 60, max: 20 });
  const input = await parseBody(c, inviteCreateSchema);
  const now = nowIso();
  const live = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM club_invites i WHERE i.club_id = ? AND ${LIVE_INVITE_SQL}`, club.id, now);
  if (Number(live?.n ?? 0) >= 20) throw new ApiError(409, "limit_reached", "This club already has 20 active invite links. Revoke one first.");
  const id = newId();
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400_000).toISOString() : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newInviteCode(LIMITS.inviteCodeLength);
    try {
      await run(
        c.env.DB,
        "INSERT INTO club_invites (id, club_id, code, created_by, expires_at, max_uses, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        id,
        club.id,
        code,
        user.id,
        expiresAt,
        input.maxUses,
        now,
      );
      break;
    } catch (err) {
      if (attempt === 4 || !/UNIQUE/i.test(err instanceof Error ? err.message : String(err))) throw err;
    }
  }
  const row = await first<Row>(c.env.DB, `${INVITE_SELECT} WHERE i.id = ? AND i.club_id = ?`, id, club.id);
  return c.json(mapInvite(c.env, row!), 201);
});

clubAdminRoutes.delete("/invites/:inviteId", requireClubRole("admin"), async (c) => {
  const club = c.get("club");
  const res = await run(
    c.env.DB,
    "UPDATE club_invites SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND club_id = ?",
    nowIso(),
    c.req.param("inviteId"),
    club.id,
  );
  if (res.meta.changes === 0) throw notFound("Invite not found");
  return c.json({ ok: true });
});

// --- Billing (stub while every club is free) -------------------------------------

clubAdminRoutes.get("/billing", async (c) => {
  const club = c.get("club");
  const billing: ClubBilling = {
    plan: club.plan,
    billingStatus: club.billingStatus,
    priceCents: CLUB_PRICE_CENTS,
    billingEnabled: false,
    message: "Every club is free while Chapterr is in beta. We will let owners know well before billing starts.",
  };
  return c.json(billing);
});
