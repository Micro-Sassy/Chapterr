import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { base64Url } from "../../worker/lib/util";
import { deriveKeys, encryptPayload, fromBase64Url, sendPush, vapidAuthorization } from "../../worker/lib/webpush";
import { notifyUsers } from "../../worker/lib/notify";
import { addToClub, as, createClub, createMember, installFetchMock, json, testEnv, type Member, type TestClub } from "./helpers";

let alice: Member;
let bob: Member;
let club: TestClub;

/** A fake browser: its own ECDH key pair and auth secret, able to decrypt what the server sends. */
interface FakeBrowser {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  privateKey: CryptoKey;
  decrypt(body: Uint8Array): Promise<string>;
}

async function fakeBrowser(endpoint: string): Promise<FakeBrowser> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint,
    keys: { p256dh: base64Url(pub), auth: base64Url(auth) },
    privateKey: pair.privateKey,
    async decrypt(body) {
      // aes128gcm header: salt(16) rs(4) idlen(1) keyid(idlen)
      const salt = body.slice(0, 16);
      const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
      const idlen = body[20]!;
      const serverPublic = body.slice(21, 21 + idlen);
      const ciphertext = body.slice(21 + idlen);
      expect(rs).toBe(4096);
      expect(idlen).toBe(65);
      const serverKey = await crypto.subtle.importKey("raw", serverPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
      const alg = { name: "ECDH", public: serverKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
      const secret = new Uint8Array(await crypto.subtle.deriveBits(alg, pair.privateKey, 256));
      const { cek, nonce } = await deriveKeys(secret, auth, pub, serverPublic, salt);
      const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["decrypt"]);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, ciphertext as BufferSource));
      // Strip the padding delimiter (0x02 for the last record) and any zero padding after it.
      let end = plain.length - 1;
      while (end >= 0 && plain[end] === 0) end--;
      expect(plain[end]).toBe(2);
      return new TextDecoder().decode(plain.slice(0, end));
    },
  };
}

beforeEach(() => {
  installFetchMock();
});
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  installFetchMock();
  // A VAPID key pair for this test run: public key as the uncompressed point, private key as the raw scalar.
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  testEnv.VAPID_PUBLIC_KEY = base64Url(pub);
  testEnv.VAPID_PRIVATE_KEY = jwk.d!;
  testEnv.VAPID_SUBJECT = "mailto:test@example.com";
  alice = await createMember("push_a");
  bob = await createMember("push_b");
  club = await createClub(alice, "Push Club");
  await addToClub(alice, club, bob);
  vi.restoreAllMocks();
});

describe("aes128gcm encryption", () => {
  it("produces a message the subscriber can decrypt with its own keys", async () => {
    const browser = await fakeBrowser("https://push.example/sub/1");
    const payload = JSON.stringify({ title: "Hello", body: "Round trip", url: "/", tag: "t" });
    const message = await encryptPayload(browser.keys.p256dh, browser.keys.auth, new TextEncoder().encode(payload));
    expect(message.body.byteLength).toBe(86 + payload.length + 1 + 16);
    expect(message.body.slice(21, 86)).toEqual(message.serverPublicKey);
    expect(await browser.decrypt(message.body)).toBe(payload);
    // Every message uses a fresh salt and key pair.
    const second = await encryptPayload(browser.keys.p256dh, browser.keys.auth, new TextEncoder().encode(payload));
    expect(second.salt).not.toEqual(message.salt);
    expect(second.serverPublicKey).not.toEqual(message.serverPublicKey);
    await expect(encryptPayload("AAAA", browser.keys.auth, new Uint8Array(1))).rejects.toThrow();
    await expect(encryptPayload(browser.keys.p256dh, browser.keys.auth, new Uint8Array(4200))).rejects.toThrow(/too large/);
  });

  it("signs a VAPID JWT that verifies with the public key", async () => {
    const header = await vapidAuthorization(testEnv, "https://push.example", Date.parse("2026-10-23T12:00:00Z"));
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(m).toBeTruthy();
    expect(m[2]).toBe(testEnv.VAPID_PUBLIC_KEY);
    const [h, c, s] = m[1]!.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(h!)))).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(c!)));
    expect(claims).toEqual({ aud: "https://push.example", exp: Math.floor(Date.parse("2026-10-23T12:00:00Z") / 1000) + 12 * 3600, sub: "mailto:test@example.com" });
    const pub = fromBase64Url(testEnv.VAPID_PUBLIC_KEY!);
    const key = await crypto.subtle.importKey("raw", pub as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, fromBase64Url(s!) as BufferSource, new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

describe("push subscriptions", () => {
  it("exposes the public key, stores and removes subscriptions per member", async () => {
    const pk = await json(await as(alice)("/api/push/public-key"));
    expect(pk).toEqual({ publicKey: testEnv.VAPID_PUBLIC_KEY });
    const browser = await fakeBrowser("https://push.example/sub/alice");
    expect((await as(alice)("/api/push/subscribe", { body: { endpoint: "http://push.example/x", keys: browser.keys } })).status).toBe(422);
    expect((await as(alice)("/api/push/subscribe", { body: { endpoint: browser.endpoint, keys: { p256dh: "short-but-long-enough-value", auth: "0123456789ab" } } })).status).toBe(422);
    const sub = await as(alice)("/api/push/subscribe", { body: { endpoint: browser.endpoint, keys: browser.keys, userAgent: "TestBrowser/1" } });
    expect(sub.status).toBe(201);
    expect(await json(sub)).toMatchObject({ endpoint: browser.endpoint, userAgent: "TestBrowser/1", lastUsedAt: null });
    // Re-posting the same endpoint is an upsert (one row), and moves it to whoever is signed in.
    expect((await as(alice)("/api/push/subscribe", { body: { endpoint: browser.endpoint, keys: browser.keys } })).status).toBe(201);
    expect(await json(await as(alice)("/api/push/subscriptions"))).toHaveLength(1);
    expect((await as(bob)("/api/push/subscribe", { body: { endpoint: browser.endpoint, keys: browser.keys } })).status).toBe(201);
    expect(await json(await as(alice)("/api/push/subscriptions"))).toHaveLength(0);
    expect((await as(alice)("/api/push/subscribe", { method: "DELETE", body: { endpoint: browser.endpoint } })).status).toBe(404);
    expect((await as(bob)("/api/push/subscribe", { method: "DELETE", body: { endpoint: browser.endpoint } })).status).toBe(200);
    expect(await json(await as(bob)("/api/push/subscriptions"))).toEqual([]);
  });

  it("sendPush encrypts for every device, sets VAPID headers, and drops gone subscriptions", async () => {
    const good = await fakeBrowser("https://push.example/sub/good");
    const gone = await fakeBrowser("https://push.example/sub/gone");
    const flaky = await fakeBrowser("https://push.example/sub/flaky");
    for (const b of [good, gone, flaky]) {
      expect((await as(alice)("/api/push/subscribe", { body: { endpoint: b.endpoint, keys: b.keys } })).status).toBe(201);
    }
    const received: { url: string; headers: Headers; body: Uint8Array }[] = [];
    vi.restoreAllMocks();
    installFetchMock(async (url, init) => {
      if (!url.startsWith("https://push.example/")) return undefined;
      const body = new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer());
      received.push({ url, headers: new Headers(init?.headers), body });
      if (url.endsWith("/gone")) return new Response(null, { status: 410 });
      if (url.endsWith("/flaky")) return new Response(null, { status: 500 });
      return new Response(null, { status: 201 });
    });
    const payload = { title: "Push Club", body: "Meeting tonight", url: `/c/${club.id}/meetings`, tag: "meeting_reminder" };
    const result = await sendPush(testEnv, alice.id, payload);
    expect(result).toEqual({ sent: 1, failed: 2, removed: 1, skipped: false });
    expect(received).toHaveLength(3);
    const toGood = received.find((r) => r.url === good.endpoint)!;
    expect(toGood.headers.get("content-encoding")).toBe("aes128gcm");
    expect(toGood.headers.get("ttl")).toBe("86400");
    expect(toGood.headers.get("content-type")).toBe("application/octet-stream");
    expect(toGood.headers.get("authorization")).toMatch(/^vapid t=.+, k=.+$/);
    expect(JSON.parse(await good.decrypt(toGood.body))).toEqual(payload);
    const toGone = received.find((r) => r.url === gone.endpoint)!;
    expect(JSON.parse(await gone.decrypt(toGone.body))).toEqual(payload);

    const subs = await json(await as(alice)("/api/push/subscriptions"));
    expect(subs.map((s: any) => s.endpoint).sort()).toEqual([flaky.endpoint, good.endpoint].sort());
    expect(subs.find((s: any) => s.endpoint === good.endpoint).lastUsedAt).toBeTruthy();
    const flakyRow = await testEnv.DB.prepare("SELECT failures FROM push_subscriptions WHERE endpoint = ?").bind(flaky.endpoint).first<any>();
    expect(flakyRow.failures).toBe(1);
    // Two more failures and the flaky one goes too.
    await sendPush(testEnv, alice.id, payload);
    await sendPush(testEnv, alice.id, payload);
    expect((await json(await as(alice)("/api/push/subscriptions"))).map((s: any) => s.endpoint)).toEqual([good.endpoint]);

    // Without VAPID configuration nothing is attempted.
    const saved = testEnv.VAPID_PRIVATE_KEY;
    testEnv.VAPID_PRIVATE_KEY = undefined;
    expect(await sendPush(testEnv, alice.id, payload)).toEqual({ sent: 0, failed: 0, removed: 0, skipped: true });
    expect((await as(alice)("/api/push/public-key")).status).toBe(404);
    testEnv.VAPID_PRIVATE_KEY = saved;
  });

  it("notifyUsers fans out to push per member preference (mentions honour push_mentions)", async () => {
    const browser = await fakeBrowser("https://push.example/sub/bob");
    expect((await as(bob)("/api/push/subscribe", { body: { endpoint: browser.endpoint, keys: browser.keys } })).status).toBe(201);
    const received: { url: string; body: Uint8Array }[] = [];
    vi.restoreAllMocks();
    installFetchMock(async (url, init) => {
      if (!url.startsWith("https://push.example/")) return undefined;
      received.push({ url, body: new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer()) });
      return new Response(null, { status: 201 });
    });
    await notifyUsers(testEnv, [bob.id], { kind: "mention", clubId: club.id, title: "Alice mentioned you", body: "@bob see this", link: `/c/${club.id}/messages`, actorId: alice.id });
    expect(received).toHaveLength(1);
    const shown = JSON.parse(await browser.decrypt(received[0]!.body));
    expect(shown).toEqual({ title: "Push Club: Alice mentioned you", body: "@bob see this", url: `/c/${club.id}/messages`, tag: `mention:${club.id}` });
    // The in-app notification is still created.
    const row = await testEnv.DB.prepare("SELECT kind FROM notifications WHERE user_id = ? AND kind = 'mention'").bind(bob.id).first();
    expect(row).toBeTruthy();

    // Turn off push for mentions: no push, in-app still delivered.
    const me = await json(await as(bob)("/api/account/me"));
    await as(bob)("/api/account/preferences", { method: "PUT", body: { ...me.preferences, pushMentions: false } });
    await notifyUsers(testEnv, [bob.id], { kind: "thread_reply", clubId: club.id, title: "New reply", actorId: alice.id });
    expect(received).toHaveLength(1);
    // Other kinds still push; push_enabled off silences everything.
    await notifyUsers(testEnv, [bob.id], { kind: "poll_opened", clubId: club.id, title: "Vote on the next book", actorId: alice.id });
    expect(received).toHaveLength(2);
    await as(bob)("/api/account/preferences", { method: "PUT", body: { ...me.preferences, pushEnabled: false } });
    await notifyUsers(testEnv, [bob.id], { kind: "poll_closed", clubId: club.id, title: "Poll closed", actorId: alice.id });
    expect(received).toHaveLength(2);
    await as(bob)("/api/account/preferences", { method: "PUT", body: me.preferences });
  });

  it("meeting reminders also go out by SMS to opted-in members (console adapter writes to the dev outbox)", async () => {
    await as(bob)("/api/account/phone", { method: "PUT", body: { phone: "+15555550100", smsOptIn: true } });
    const me = await json(await as(bob)("/api/account/me"));
    await as(bob)("/api/account/preferences", { method: "PUT", body: { ...me.preferences, smsMeetingReminders: true } });
    await notifyUsers(testEnv, [bob.id], { kind: "meeting_reminder", clubId: club.id, title: "Meeting in 2 hours", body: "The library, 7pm", actorId: alice.id });
    const sms = await testEnv.DB.prepare("SELECT subject, text_body FROM dev_outbox WHERE to_address = ? ORDER BY created_at DESC LIMIT 1").bind("+15555550100").first<any>();
    expect(sms?.subject).toBe("SMS");
    expect(sms?.text_body).toBe("Push Club: Meeting in 2 hours The library, 7pm");
    // The reminder email respects email_meeting_reminders (on by default).
    const mail = await testEnv.DB.prepare("SELECT subject FROM dev_outbox WHERE to_address = ? ORDER BY created_at DESC LIMIT 1").bind(bob.email.toLowerCase()).first<any>();
    expect(mail?.subject).toContain("Meeting in 2 hours");
    // Other kinds never text.
    await notifyUsers(testEnv, [bob.id], { kind: "poll_opened", clubId: club.id, title: "Not a text", actorId: alice.id });
    const count = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM dev_outbox WHERE to_address = ?").bind("+15555550100").first<any>();
    expect(count.n).toBe(1);
  });
});
