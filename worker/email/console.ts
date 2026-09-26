import { newId, nowIso } from "../lib/util";
import type { EmailMessage, EmailProvider } from "./types";

/**
 * Development-only provider: logs the email and stores it in the dev_outbox
 * table so local testers (and the end-to-end tests) can follow links.
 * createEmailProvider() refuses to use this in production.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  constructor(private db: D1Database) {}

  async send(message: EmailMessage): Promise<void> {
    console.log(`[dev email] to=${message.to} subject="${message.subject}"\n${message.text}`);
    await this.db
      .prepare(
        "INSERT INTO dev_outbox (id, to_address, subject, text_body, html_body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(newId(), message.to, message.subject, message.text, message.html, nowIso())
      .run();
  }
}
