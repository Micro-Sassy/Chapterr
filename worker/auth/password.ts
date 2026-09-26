import { base64ToBytes, bytesToBase64, timingSafeEqual } from "../lib/util";

/**
 * Password hashing with PBKDF2-HMAC-SHA256 via the Workers-native WebCrypto API.
 *
 * Why not Better Auth's default scrypt? It runs in pure JavaScript and can
 * exceed the Workers Free plan CPU budget. WebCrypto PBKDF2 is implemented
 * natively. Cloudflare caps PBKDF2 at 100,000 iterations, which is used here.
 * The format is self-describing so parameters can be raised later.
 *
 * Format: pbkdf2_sha256$<iterations>$<salt base64>$<hash base64>
 */
const ITERATIONS = 100_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

async function derive(password: string, salt: Uint8Array, iterations: number, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFKC")), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, length * 8);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS, KEY_BYTES);
  return `pbkdf2_sha256$${ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const parts = hash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64ToBytes(parts[2]!);
    expected = base64ToBytes(parts[3]!);
  } catch {
    return false;
  }
  const actual = await derive(password, salt, iterations, expected.length);
  return timingSafeEqual(actual, expected);
}
