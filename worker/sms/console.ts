import { escapeHtml, newId, nowIso } from "../lib/util";
import type { SmsProvider } from "./types";

/**
 * Development adapter: logs the text and files it in dev_outbox with the
 * subject "SMS" so local testers can read it from /api/dev/outbox?to=<phone>.
 * createSmsProvider never returns this in production.
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  constructor(private db: D1Database) {}

  async send(to: string, text: string): Promise<void> {
    console.log(`[dev sms] to=${to}\n${text}`);
    await this.db
      .prepare("INSERT INTO dev_outbox (id, to_address, subject, text_body, html_body, created_at) VALUES (?, ?, 'SMS', ?, ?, ?)")
      .bind(newId(), to, text, `<p>${escapeHtml(text)}</p>`, nowIso())
      .run();
  }
}
