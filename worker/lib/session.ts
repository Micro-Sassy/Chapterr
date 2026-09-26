import type { MiddlewareHandler } from "hono";
import { getAuth } from "../auth/auth";
import type { AppEnv } from "../env";
import { unauthorized } from "./errors";

/**
 * Every private API route sits behind this middleware: a valid, unexpired
 * Better Auth session for a member with a verified email is required.
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await getAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session || !session.user.emailVerified) throw unauthorized();
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
};
