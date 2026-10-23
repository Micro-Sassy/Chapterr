import type { SmsProvider } from "./types";

/** Twilio Programmable Messaging over its REST API (no SDK). */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";
  constructor(
    private accountSid: string,
    private authToken: string,
    private from: string,
  ) {}

  async send(to: string, text: string): Promise<void> {
    const body = new URLSearchParams({ To: to, From: this.from, Body: text });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${this.accountSid}:${this.authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Twilio responded ${res.status}: ${detail.slice(0, 200)}`);
    }
  }
}
