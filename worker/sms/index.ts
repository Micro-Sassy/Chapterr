import { isProduction, type Env } from "../env";
import { first } from "../lib/db";
import { ConsoleSmsProvider } from "./console";
import { TwilioSmsProvider } from "./twilio";
import type { SmsProvider } from "./types";

export type { SmsProvider } from "./types";

/**
 * Pick the SMS adapter: Twilio when all three secrets are set, the console
 * adapter in development, nothing in production without Twilio.
 */
export function createSmsProvider(env: Env): SmsProvider | null {
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM) {
    return new TwilioSmsProvider(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM);
  }
  if (isProduction(env)) return null;
  return new ConsoleSmsProvider(env.DB);
}

export function smsConfigured(env: Env): boolean {
  return createSmsProvider(env) !== null;
}

/**
 * Text a member, provided they gave a phone number, opted in, and keep SMS
 * meeting reminders on. Returns true when a message was handed to the adapter.
 * Never throws: SMS is a convenience channel.
 */
export async function sendSms(env: Env, userId: string, text: string): Promise<boolean> {
  try {
    const provider = createSmsProvider(env);
    if (!provider) return false;
    const row = await first<{ phone: string | null; sms_opt_in: number; pref: number | null }>(
      env.DB,
      `SELECT p.phone, p.sms_opt_in, np.sms_meeting_reminders AS pref
         FROM profiles p LEFT JOIN notification_preferences np ON np.user_id = p.user_id
        WHERE p.user_id = ?`,
      userId,
    );
    if (!row?.phone || Number(row.sms_opt_in) !== 1 || Number(row.pref ?? 0) !== 1) return false;
    await provider.send(row.phone, text.slice(0, 320));
    return true;
  } catch (err) {
    console.error("sms failed", err instanceof Error ? err.message : err);
    return false;
  }
}
