import type { EmailMessage, EmailProvider } from "./types";

/**
 * Resend (https://resend.com) over its REST API. Runs only inside the Worker;
 * the API key never reaches the browser.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    if (!res.ok) {
      // Do not include the response body in thrown errors: it may echo addresses.
      throw new Error(`Resend rejected the email (HTTP ${res.status})`);
    }
  }
}
