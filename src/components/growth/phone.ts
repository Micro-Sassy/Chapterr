export const PHONE_HELP = "International format with the country code, for example +1 214 555 1234. Spaces and dashes are fine.";

export interface PhoneCheck {
  ok: boolean;
  /** Digits and a leading plus only, as the API stores it. Empty when clearing the number. */
  normalized: string;
  message: string | null;
}

/**
 * Normalise what a member typed into E.164 and explain, in one sentence, what to fix.
 * An empty value is valid and clears the number.
 */
export function checkPhone(input: string): PhoneCheck {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, normalized: "", message: null };
  let digits = trimmed.replace(/[\s().-]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith("+")) return { ok: false, normalized: digits, message: "Start with your country code, such as +1 for the US or +44 for the UK." };
  if (!/^\+\d+$/.test(digits)) return { ok: false, normalized: digits, message: "Use digits only after the plus sign." };
  if (digits[1] === "0") return { ok: false, normalized: digits, message: "The country code cannot start with 0." };
  const count = digits.length - 1;
  if (count < 7) return { ok: false, normalized: digits, message: "That number looks too short. Include the area code." };
  if (count > 15) return { ok: false, normalized: digits, message: "That number looks too long. Check for extra digits." };
  return { ok: true, normalized: digits, message: null };
}

/** Display form for E.164 numbers, grouped for reading. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+(1)(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (m) return `+${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
  return e164.replace(/(\d{3})(?=\d)/g, "$1 ");
}
