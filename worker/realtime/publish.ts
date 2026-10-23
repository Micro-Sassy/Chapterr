import type { RealtimeEvent } from "../../shared/types";
import type { Env } from "../env";
import { clubIdsFor } from "../lib/club";

/** The Durable Object that holds every live socket of one club. */
export function realtimeStub(env: Env, clubId: string) {
  return env.REALTIME.get(env.REALTIME.idFromName(`club:${clubId}`));
}

/** Best-effort realtime fan-out inside one club. D1 is the source of truth, so failures are logged, not thrown. */
export async function publish(env: Env, clubId: string, userIds: string[] | "all", event: RealtimeEvent): Promise<void> {
  try {
    await realtimeStub(env, clubId).publish(userIds, event);
  } catch (err) {
    console.error("realtime publish failed", err instanceof Error ? err.message : err);
  }
}

/** Close a user's sockets on one club's Durable Object (member removed, left, club archived). */
export async function disconnectUserFromClub(env: Env, clubId: string, userId: string): Promise<void> {
  try {
    await realtimeStub(env, clubId).disconnectUser(userId);
  } catch (err) {
    console.error("realtime disconnect failed", err instanceof Error ? err.message : err);
  }
}

/** Close every socket of a user across all their clubs (password reset, account deletion). */
export async function disconnectUser(env: Env, userId: string): Promise<void> {
  const clubs = await clubIdsFor(env.DB, userId);
  await Promise.all(clubs.map((clubId) => disconnectUserFromClub(env, clubId, userId)));
}

/** Close the sockets opened with one session across the user's clubs (sign-out, revoked session). */
export async function disconnectSession(env: Env, userId: string, sessionId: string): Promise<void> {
  try {
    const clubs = await clubIdsFor(env.DB, userId);
    await Promise.all(clubs.map((clubId) => realtimeStub(env, clubId).disconnectSession(sessionId)));
  } catch (err) {
    console.error("realtime disconnect failed", err instanceof Error ? err.message : err);
  }
}
