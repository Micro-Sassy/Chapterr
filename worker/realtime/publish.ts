import type { RealtimeEvent } from "../../shared/types";
import type { Env } from "../env";

export function realtimeStub(env: Env) {
  return env.REALTIME.get(env.REALTIME.idFromName("club"));
}

/** Best-effort realtime fan-out. D1 is the source of truth, so failures are logged, not thrown. */
export async function publish(env: Env, userIds: string[] | "all", event: RealtimeEvent): Promise<void> {
  try {
    await realtimeStub(env).publish(userIds, event);
  } catch (err) {
    console.error("realtime publish failed", err instanceof Error ? err.message : err);
  }
}

export async function disconnectUser(env: Env, userId: string): Promise<void> {
  await realtimeStub(env).disconnectUser(userId);
}

export async function disconnectSession(env: Env, sessionId: string): Promise<void> {
  try {
    await realtimeStub(env).disconnectSession(sessionId);
  } catch (err) {
    console.error("realtime disconnect failed", err instanceof Error ? err.message : err);
  }
}
