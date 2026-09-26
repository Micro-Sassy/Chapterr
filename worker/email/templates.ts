import { escapeHtml } from "../lib/util";
import type { EmailMessage } from "./types";

const BRAND = {
  name: "Teel Ridge Book Club",
  ink: "#1f2a24",
  accent: "#2f5d46",
  paper: "#f7f3ea",
  muted: "#5b6660",
};

function layout(opts: { preheader: string; heading: string; paragraphs: string[]; action?: { label: string; url: string }; footnote: string }) {
  const { preheader, heading, paragraphs, action, footnote } = opts;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.paper};font-family:Georgia,'Times New Roman',serif;color:${BRAND.ink};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.paper};padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e4ddd0;border-radius:12px;">
<tr><td style="padding:28px 32px 8px 32px;">
<div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:${BRAND.accent};font-family:Arial,Helvetica,sans-serif;font-weight:bold;">${BRAND.name}</div>
<h1 style="font-size:24px;line-height:1.3;margin:16px 0 8px 0;font-weight:normal;">${escapeHtml(heading)}</h1>
</td></tr>
<tr><td style="padding:0 32px;font-size:16px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;color:${BRAND.ink};">
${paragraphs.map((p) => `<p style="margin:12px 0;">${escapeHtml(p)}</p>`).join("\n")}
${
  action
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:${BRAND.accent};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;">${escapeHtml(action.label)}</a></p>
<p style="margin:12px 0;font-size:13px;color:${BRAND.muted};">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all;">${escapeHtml(action.url)}</span></p>`
    : ""
}
</td></tr>
<tr><td style="padding:16px 32px 28px 32px;font-size:12px;line-height:1.5;color:${BRAND.muted};font-family:Arial,Helvetica,sans-serif;border-top:1px solid #efe9dd;">
${escapeHtml(footnote)}
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
  const text = [
    BRAND.name.toUpperCase(),
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
    preheader: "Confirm your email to finish joining the book club.",
    heading: "Confirm your email address",
    paragraphs: [
      `Hi ${name},`,
      "Welcome to the Teel Ridge Book Club app. Please confirm this is your email address to finish setting up your account.",
      "This link expires in 24 hours.",
    ],
    action: { label: "Confirm email", url },
    footnote: "If you did not create an account, you can ignore this email — no account will be activated without confirmation.",
  });
  return { to, subject: "Confirm your email — Teel Ridge Book Club", html, text };
}

export function changeEmailVerification(to: string, name: string, url: string): EmailMessage {
  const { html, text } = layout({
    preheader: "Confirm your new email address.",
    heading: "Confirm your new email address",
    paragraphs: [
      `Hi ${name},`,
      "You asked to change the email address on your Teel Ridge Book Club account to this one. Confirm the change to start using it.",
      "This link expires in 24 hours.",
    ],
    action: { label: "Confirm new email", url },
    footnote: "If you did not request this change, ignore this email and your address will stay the same.",
  });
  return { to, subject: "Confirm your new email — Teel Ridge Book Club", html, text };
}

export function passwordResetEmail(to: string, name: string, url: string): EmailMessage {
  const { html, text } = layout({
    preheader: "Reset your book club password.",
    heading: "Reset your password",
    paragraphs: [
      `Hi ${name},`,
      "Someone (hopefully you) asked to reset the password for your Teel Ridge Book Club account. Use the button below to choose a new password.",
      "This link expires in 1 hour and can be used once. After you reset your password, you will be signed out on every device.",
    ],
    action: { label: "Choose a new password", url },
    footnote: "If you did not ask for this, you can ignore this email. Your password will not change.",
  });
  return { to, subject: "Reset your password — Teel Ridge Book Club", html, text };
}

export function passwordChangedEmail(to: string, name: string): EmailMessage {
  const { html, text } = layout({
    preheader: "Your password was changed.",
    heading: "Your password was changed",
    paragraphs: [
      `Hi ${name},`,
      "The password for your Teel Ridge Book Club account was just reset, and all existing sessions were signed out.",
      "If this was not you, reset your password again immediately using “Forgot password” on the sign-in page.",
    ],
    footnote: "This is an automated security notice.",
  });
  return { to, subject: "Your password was changed — Teel Ridge Book Club", html, text };
}

export function clubUpdateEmail(to: string, name: string, heading: string, lines: string[], url: string): EmailMessage {
  const { html, text } = layout({
    preheader: heading,
    heading,
    paragraphs: [`Hi ${name},`, ...lines],
    action: { label: "Open the book club", url },
    footnote: "You are receiving this because club update emails are turned on in your notification settings.",
  });
  return { to, subject: `${heading} — Teel Ridge Book Club`, html, text };
}
