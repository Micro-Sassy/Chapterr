import { isProduction, type Env } from "../env";
import { ConsoleEmailProvider } from "./console";
import { ResendEmailProvider } from "./resend";
import type { EmailProvider } from "./types";

export type { EmailMessage, EmailProvider } from "./types";

export function createEmailProvider(env: Env): EmailProvider {
  const provider = (env.EMAIL_PROVIDER || "resend").toLowerCase();
  if (provider === "console") {
    if (isProduction(env)) {
      throw new Error("EMAIL_PROVIDER=console is not allowed when APP_ENV=production");
    }
    return new ConsoleEmailProvider(env.DB);
  }
  if (provider === "resend") {
    if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
    if (!env.EMAIL_FROM || env.EMAIL_FROM.includes("REPLACE_WITH")) throw new Error("EMAIL_FROM is not configured");
    return new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM);
  }
  throw new Error(`Unknown EMAIL_PROVIDER "${provider}"`);
}
