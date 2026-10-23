import { APP_NAME } from "../../shared/constants";
import { escapeHtml } from "../lib/util";
import type { EmailMessage } from "./types";

/**
 * Chapterr email styling. Colours follow the brand palette; body copy is a
 * system sans-serif (Inter where installed), headings are Georgia. The voice
 * is warm and precise, without exclamation marks.
 */
const BRAND = {
  name: APP_NAME,
  forest: "#1E3A2F",
  brass: "#B8903F",
  linen: "#F4EEE2",
  parchment: "#FBF8F1",
  thread: "#E3DAC6",
  moss: "#4B5E55",
  // Filled in with PUBLIC_APP_URL by createEmailProvider.
  logo: "%%APP_ORIGIN%%/brand/chapterr/logo-horizontal-color-on-light.png",
};
const SANS = "Inter,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

function layout(opts: { preheader: string; heading: string; paragraphs: string[]; action?: { label: string; url: string }; footnote: string }) {
  const { preheader, heading, paragraphs, action, footnote } = opts;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.linen};font-family:${SANS};color:${BRAND.forest};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.linen};padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:${BRAND.parchment};border:1px solid ${BRAND.thread};border-radius:8px;">
<tr><td align="left" style="padding:28px 32px 8px 32px;">
<img src="${BRAND.logo}" width="140" alt="${BRAND.name}" style="display:block;width:140px;max-width:100%;height:auto;border:0;">
</td></tr>
<tr><td style="padding:8px 32px 0 32px;">
<h1 style="font-family:${SERIF};font-size:24px;line-height:1.3;margin:12px 0 8px 0;font-weight:normal;color:${BRAND.forest};">${escapeHtml(heading)}</h1>
<div style="margin:0 0 4px 0;width:48px;border-top:2px solid ${BRAND.brass};line-height:0;font-size:0;">&nbsp;</div>
</td></tr>
<tr><td style="padding:0 32px;font-size:16px;line-height:1.6;font-family:${SANS};color:${BRAND.forest};">
${paragraphs.map((p) => `<p style="margin:12px 0;">${escapeHtml(p)}</p>`).join("\n")}
${
  action
    ? `<p style="margin:26px 0;"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:${BRAND.forest};color:${BRAND.parchment};text-decoration:none;padding:12px 24px;border-radius:6px;font-family:${SANS};font-size:16px;font-weight:600;">${escapeHtml(action.label)}</a></p>
<p style="margin:12px 0;font-size:13px;color:${BRAND.moss};">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all;">${escapeHtml(action.url)}</span></p>`
    : ""
}
</td></tr>
<tr><td style="padding:16px 32px 28px 32px;font-size:13px;line-height:1.5;color:${BRAND.moss};font-family:${SANS};border-top:1px solid ${BRAND.thread};">
${escapeHtml(footnote)}
</td></tr>
</table>
<p style="max-width:540px;margin:16px auto 0 auto;font-size:12px;line-height:1.5;color:${BRAND.moss};font-family:${SANS};text-align:center;">${BRAND.name}: your club, one shelf.</p>
</td></tr>
</table>
</body></html>`;
  const text = [
    BRAND.name,
    "",
    heading,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...(action ? [`${action.label}: ${action.url}`, ""] : []),
    footnote,
  ].join("\n");
  return { html, text };
}

export function verificationEmail(to: string, name: string, url: string): EmailMessage {
  const { html, text } = layout({
    preheader: "Confirm your email to finish setting up your Chapterr account.",
    heading: "Confirm your email address",
    paragraphs: [
      `Hi ${name},`,
      `Welcome to ${BRAND.name}. Please confirm this is your email address to finish setting up your account.`,
      "This link expires in 24 hours.",
    ],
    action: { label: "Confirm email", url },
    footnote: "If you did not create an account, you can ignore this email. No account is activated without confirmation.",
  });
  return { to, subject: `Confirm your email · ${BRAND.name}`, html, text };
}

export function changeEmailVerification(to: string, name: string, url: string): EmailMessage {
  const { html, text } = layout({
    preheader: "Confirm your new email address.",
    heading: "Confirm your new email address",
    paragraphs: [
      `Hi ${name},`,
      `You asked to change the email address on your ${BRAND.name} account to this one. Confirm the change to start using it.`,
      "This link expires in 24 hours.",
    ],
    action: { label: "Confirm new email", url },
    footnote: "If you did not request this change, ignore this email and your address will stay the same.",
  });
  return { to, subject: `Confirm your new email · ${BRAND.name}`, html, text };
}

export function passwordResetEmail(to: string, name: string, url: string): EmailMessage {
  const { html, text } = layout({
    preheader: "Reset your Chapterr password.",
    heading: "Reset your password",
    paragraphs: [
      `Hi ${name},`,
      `Someone, most likely you, asked to reset the password for your ${BRAND.name} account. Use the button below to choose a new password.`,
      "This link expires in 1 hour and can be used once. After you reset your password, you will be signed out on every device.",
    ],
    action: { label: "Choose a new password", url },
    footnote: "If you did not ask for this, you can ignore this email. Your password will not change.",
  });
  return { to, subject: `Reset your password · ${BRAND.name}`, html, text };
}

export function passwordChangedEmail(to: string, name: string): EmailMessage {
  const { html, text } = layout({
    preheader: "Your password was changed.",
    heading: "Your password was changed",
    paragraphs: [
      `Hi ${name},`,
      `The password for your ${BRAND.name} account was just reset, and all existing sessions were signed out.`,
      "If this was not you, reset your password again straight away using “Forgot password” on the sign-in page.",
    ],
    footnote: "This is an automated security notice.",
  });
  return { to, subject: `Your password was changed · ${BRAND.name}`, html, text };
}

/** A club update (new meeting, assignment, recommendation). Names the club in the subject and the button. */
export function clubUpdateEmail(to: string, name: string, clubName: string, heading: string, lines: string[], url: string): EmailMessage {
  const { html, text } = layout({
    preheader: `${clubName}: ${heading}`,
    heading,
    paragraphs: [`Hi ${name},`, ...lines],
    action: { label: `Open ${clubName}`, url },
    footnote: `You are receiving this because club update emails are turned on in your ${BRAND.name} notification settings.`,
  });
  return { to, subject: `${clubName}: ${heading} · ${BRAND.name}`, html, text };
}
