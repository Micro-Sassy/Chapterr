/** Outbound SMS adapter. Only meeting reminders use it, and only for members who opted in. */
export interface SmsProvider {
  readonly name: "console" | "twilio";
  /** `to` is an E.164 number; `text` is plain text (kept under 320 characters by callers). */
  send(to: string, text: string): Promise<void>;
}
