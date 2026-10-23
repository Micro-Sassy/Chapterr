import { getAuth } from "../auth/auth";
import type { Env } from "../env";
import { enforceRateLimit } from "../security/rate-limit";
import { ApiError } from "./errors";

/** Re-check the member's current password before a sensitive change (account changes, club ownership, club deletion). */
export async function confirmPassword(c: { env: Env; req: { raw: Request } }, userId: string, password: string): Promise<void> {
  await enforceRateLimit(c.env, "password-confirm", userId, { window: 15 * 60, max: 10 });
  try {
    await getAuth(c.env).api.verifyPassword({ body: { password }, headers: c.req.raw.headers });
  } catch {
    throw new ApiError(400, "invalid_password", "Your current password is incorrect", { fields: { currentPassword: ["Incorrect password"] } });
  }
}
