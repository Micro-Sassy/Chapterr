import type { PushPayload } from "../../shared/types";
import type { Env } from "../env";
import { all } from "./db";
import { base64ToBytes, base64Url, nowIso } from "./util";

/**
 * Web Push without dependencies: RFC 8291 message encryption (aes128gcm) and
 * RFC 8292 VAPID authentication, both on WebCrypto. The service worker
 * (src/sw-push.ts) receives the JSON payload and shows a notification.
 */

const enc = new TextEncoder();

export function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bits: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const out = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, key, bits);
  return new Uint8Array(out);
}

export interface EncryptedMessage {
  /** aes128gcm body: header (salt, rs, keyid = server public key) followed by the single encrypted record. */
  body: Uint8Array;
  /** The ephemeral server public key (uncompressed point, 65 bytes), also present in the header. */
  serverPublicKey: Uint8Array;
  salt: Uint8Array;
}

/** Record size: one record carries the whole payload (max 4078 bytes of plaintext). */
export const RECORD_SIZE = 4096;

/**
 * Encrypt `plaintext` for a subscription (RFC 8291 §3). `p256dh` and `auth`
 * are the subscription's keys as the browser hands them out (base64url).
 */
export async function encryptPayload(p256dh: string, auth: string, plaintext: Uint8Array): Promise<EncryptedMessage> {
  if (plaintext.byteLength > RECORD_SIZE - 17 - 1) throw new Error("Push payload too large");
  const uaPublic = fromBase64Url(p256dh);
  const authSecret = fromBase64Url(auth);
  if (uaPublic.byteLength !== 65 || authSecret.byteLength !== 16) throw new Error("Invalid subscription keys");

  const serverKeys = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const serverPublic = new Uint8Array((await crypto.subtle.exportKey("raw", serverKeys.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // The runtime property is `public`; the Workers type declares it as `$public`.
  const ecdhAlgorithm = { name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhAlgorithm, serverKeys.privateKey, 256));

  const keys = await deriveKeys(ecdhSecret, authSecret, uaPublic, serverPublic);
  const padded = concat(plaintext, new Uint8Array([2])); // 0x02: last record delimiter, no padding
  const cek = await crypto.subtle.importKey("raw", keys.cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: keys.nonce as BufferSource }, cek, padded as BufferSource));

  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(keys.salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = 65;
  header.set(serverPublic, 21);
  return { body: concat(header, ciphertext), serverPublicKey: serverPublic, salt: keys.salt };
}

/**
 * Key schedule shared by encryption (here) and decryption (tests):
 * IKM = HKDF(auth, ecdh, "WebPush: info" || ua_public || as_public, 32);
 * CEK = HKDF(salt, IKM, "Content-Encoding: aes128gcm", 16); NONCE = HKDF(salt, IKM, "Content-Encoding: nonce", 12).
 */
export async function deriveKeys(
  ecdhSecret: Uint8Array,
  authSecret: Uint8Array,
  uaPublic: Uint8Array,
  serverPublic: Uint8Array,
  salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
): Promise<{ cek: Uint8Array; nonce: Uint8Array; salt: Uint8Array }> {
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, serverPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 256);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 96);
  return { cek, nonce, salt };
}

// --- VAPID -------------------------------------------------------------------------

export function vapidConfigured(env: Env): boolean {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

/**
 * Import the signing key. VAPID_PRIVATE_KEY is the usual 32-byte base64url
 * scalar (as `web-push generate-vapid-keys` prints), paired with the 65-byte
 * VAPID_PUBLIC_KEY; a JSON JWK is accepted too.
 */
async function importVapidKey(env: Env): Promise<CryptoKey> {
  const priv = env.VAPID_PRIVATE_KEY!.trim();
  const alg = { name: "ECDSA", namedCurve: "P-256" } as const;
  if (priv.startsWith("{")) {
    return crypto.subtle.importKey("jwk", JSON.parse(priv) as JsonWebKey, alg, false, ["sign"]);
  }
  const pub = fromBase64Url(env.VAPID_PUBLIC_KEY!.trim());
  if (pub.byteLength !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY must be an uncompressed P-256 point");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: base64Url(pub.slice(1, 33)),
    y: base64Url(pub.slice(33, 65)),
    d: base64Url(fromBase64Url(priv)),
    ext: true,
  };
  return crypto.subtle.importKey("jwk", jwk, alg, false, ["sign"]);
}

/** `Authorization: vapid t=<jwt>, k=<public key>` for the push service at `audience` (RFC 8292 §3). */
export async function vapidAuthorization(env: Env, audience: string, now = Date.now()): Promise<string> {
  const key = await importVapidKey(env);
  const header = base64Url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64Url(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const signingInput = `${header}.${claims}`;
  // WebCrypto ECDSA signatures are already the raw r||s form JWS expects.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput)));
  return `vapid t=${signingInput}.${base64Url(sig)}, k=${env.VAPID_PUBLIC_KEY!.trim()}`;
}

// --- Sending ---------------------------------------------------------------------------

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failures: number;
}

export interface PushResult {
  sent: number;
  failed: number;
  /** Subscriptions removed because the push service said they are gone (404/410) or failed repeatedly. */
  removed: number;
  /** True when VAPID is not configured and nothing was attempted. */
  skipped: boolean;
}

/** Subscriptions are dropped after this many consecutive failures that are not a definite 404/410. */
const MAX_FAILURES = 3;

/** Send one message to one subscription. Returns the push service's status (0 = network error). */
export async function sendToSubscription(env: Env, sub: { endpoint: string; p256dh: string; auth: string }, payload: PushPayload): Promise<number> {
  const audience = new URL(sub.endpoint).origin;
  const [authorization, encrypted] = await Promise.all([
    vapidAuthorization(env, audience),
    encryptPayload(sub.p256dh, sub.auth, enc.encode(JSON.stringify(payload))),
  ]);
  try {
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",
        Urgency: "normal",
        ...(payload.tag ? { Topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}),
      },
      body: encrypted.body as unknown as ArrayBuffer,
      signal: AbortSignal.timeout(8000),
    });
    return res.status;
  } catch (err) {
    console.error("push send failed", err instanceof Error ? err.message : err);
    return 0;
  }
}

/**
 * Deliver a notification to every push subscription of a member. Best effort:
 * never throws. Gone subscriptions (404/410) are deleted at once; others are
 * deleted after three consecutive failures.
 */
export async function sendPush(env: Env, userId: string, payload: PushPayload): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: 0, removed: 0, skipped: false };
  if (!vapidConfigured(env)) {
    result.skipped = true;
    return result;
  }
  let subs: SubscriptionRow[];
  try {
    subs = await all<SubscriptionRow>(env.DB, "SELECT id, endpoint, p256dh, auth, failures FROM push_subscriptions WHERE user_id = ?", userId);
  } catch (err) {
    console.error("push subscriptions lookup failed", err instanceof Error ? err.message : err);
    return result;
  }
  if (subs.length === 0) return result;
  const stmts: D1PreparedStatement[] = [];
  const now = nowIso();
  await Promise.all(
    subs.map(async (sub) => {
      let status = 0;
      try {
        status = await sendToSubscription(env, sub, payload);
      } catch (err) {
        console.error("push encryption failed", err instanceof Error ? err.message : err);
      }
      if (status >= 200 && status < 300) {
        result.sent++;
        stmts.push(env.DB.prepare("UPDATE push_subscriptions SET last_used_at = ?, failures = 0 WHERE id = ?").bind(now, sub.id));
      } else if (status === 404 || status === 410 || Number(sub.failures) + 1 >= MAX_FAILURES) {
        result.failed++;
        result.removed++;
        stmts.push(env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id));
      } else {
        result.failed++;
        stmts.push(env.DB.prepare("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?").bind(sub.id));
      }
    }),
  );
  if (stmts.length) {
    try {
      await env.DB.batch(stmts);
    } catch (err) {
      console.error("push bookkeeping failed", err instanceof Error ? err.message : err);
    }
  }
  return result;
}
