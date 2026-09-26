export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Transactional email provider. Swap implementations without touching callers. */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}
