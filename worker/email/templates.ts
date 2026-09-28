import { escapeHtml } from "../lib/util";
import type { EmailMessage } from "./types";

const BRAND = {
  name: "Teel Ridge Book Club",
  ink: "#2a2319",
  accent: "#213a2f",
  paper: "#f1e7d0",
  card: "#faf5e8",
  line: "#d6c49f",
  gold: "#9c7a34",
  muted: "#6a5c46",
  // Filled in with PUBLIC_APP_URL by createEmailProvider.
  logo: "%%APP_ORIGIN%%/brand/logo-horizontal-green.png",
};
const SERIF = "'EB Garamond',Garamond,Georgia,'Times New Roman',serif";

function layout(opts: { preheader: string; heading: string; paragraphs: string[]; action?: { label: string; url: string }; footnote: string }) {
  const { preheader, heading, paragraphs, action, footnote } = opts;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.paper};font-family:${SERIF};color:${BRAND.ink};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.paper};padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:${BRAND.card};border:1px solid ${BRAND.line};border-radius:6px;">
<tr><td align="center" style="padding:28px 32px 4px 32px;">
<img src="${BRAND.logo}" width="280" height="52" alt="${BRAND.name}" style="display:block;width:280px;max-width:100%;height:auto;border:0;">
<div style="margin:18px auto 0 auto;width:120px;border-top:1px solid ${BRAND.gold};line-height:0;font-size:0;">&nbsp;</div>
</td></tr>
<tr><td style="padding:8px 32px 0 32px;">
<h1 style="font-family:${SERIF};font-size:26px;line-height:1.3;margin:16px 0 8px 0;font-weight:normal;color:${BRAND.accent};text-align:center;">${escapeHtml(heading)}</h1>
</td></tr>
<tr><td style="padding:0 32px;font-size:17px;line-height:1.6;font-family:${SERIF};color:${BRAND.ink};">
${paragraphs.map((p) => `<p style="margin:12px 0;">${escapeHtml(p)}</p>`).join("\n")}
${
  action
    ? `<p style="margin:26px 0;text-align:center;"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:${BRAND.accent};color:#f6eedb;text-decoration:none;padding:12px 26px;border-radius:4px;font-family:${SERIF};font-size:17px;letter-spacing:.04em;">${escapeHtml(action.label)}</a></p>
<p style="margin:12px 0;font-size:14px;color:${BRAND.muted};">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all;">${escapeHtml(action.url)}</span></p>`
    : ""
}
</td></tr>
<tr><td style="padding:16px 32px 28px 32px;font-size:13px;line-height:1.5;color:${BRAND.muted};font-family:${SERIF};font-style:italic;border-top:1px solid ${BRAND.line};">
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
