import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext } from "cloudflare:test";
import worker from "../../worker/index";
import { call, cookieFrom, createMember, installFetchMock, json, latestEmail, linkIn, nextIp, testEnv } from "./helpers";

beforeEach(() => {
  installFetchMock();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("registration", () => {
  it("requires Turnstile", async () => {
    const res = await call("/api/auth/sign-up/email", {
      body: { name: "No Captcha", email: "nocaptcha@example.com", password: "long enough password", username: "nocaptcha", acceptPrivacy: true },
      ip: nextIp(),
    });
    expect(res.status).toBe(403);
    const failed = await call("/api/auth/sign-up/email", {
      body: { name: "Bad Captcha", email: "badcaptcha@example.com", password: "long enough password", username: "badcaptcha", acceptPrivacy: true },
      headers: { "x-turnstile-token": "fail" },
      ip: nextIp(),
    });
    expect(failed.status).toBe(403);
  });

  it("requires acceptance of the privacy notice and a valid username", async () => {
    const ip = nextIp();
    const res = await call("/api/auth/sign-up/email", {
      body: { name: "Privacy", email: "privacy@example.com", password: "long enough password", username: "privacy_x", acceptPrivacy: false },
      headers: { "x-turnstile-token": "ok" },
      ip,
    });
    expect(res.status).toBe(422);
    const bad = await call("/api/auth/sign-up/email", {
      body: { name: "Bad", email: "bad-user@example.com", password: "long enough password", username: "bad user!", acceptPrivacy: true },
      headers: { "x-turnstile-token": "ok" },
      ip,
    });
    expect(bad.status).toBe(422);
    const reserved = await call("/api/auth/sign-up/email", {
      body: { name: "Admin", email: "admin-user@example.com", password: "long enough password", username: "admin", acceptPrivacy: true },
      headers: { "x-turnstile-token": "ok" },
      ip,
    });
    expect(reserved.status).toBe(422);
  });

  it("requires email verification before a session is issued", async () => {
    const ip = nextIp();
    const email = "unverified@example.com";
    const signup = await call("/api/auth/sign-up/email", {
      body: { name: "Unverified", email, password: "long enough password", username: "unverified_1", acceptPrivacy: true },
      headers: { "x-turnstile-token": "ok" },
      ip,
    });
    expect(signup.status).toBe(200);
    expect(cookieFrom(signup)).not.toContain("session_token");
    const signin = await call("/api/auth/sign-in/email", {
      body: { email, password: "long enough password" },
      headers: { "x-turnstile-token": "ok" },
      ip,
    });
    expect(signin.status).toBe(403);
    const mail = await latestEmail(email);
    expect(mail?.subject).toMatch(/Confirm your email/);
    // Profile row was created with the privacy acceptance timestamp.
    const profile = await testEnv.DB.prepare(
      'SELECT p.privacy_accepted_at FROM profiles p JOIN "user" u ON u.id = p.user_id WHERE u.email = ?',
    )
      .bind(email)
      .first<{ privacy_accepted_at: string }>();
    expect(profile?.privacy_accepted_at).toBeTruthy();
  });

  it("treats usernames case-insensitively", async () => {
    const a = await createMember("casey");
    const res = await call("/api/auth/sign-up/email", {
      body: { name: "Dup", email: "dup-case@example.com", password: "long enough password", username: a.username.toUpperCase(), acceptPrivacy: true },
      headers: { "x-turnstile-token": "ok" },
      ip: nextIp(),
    });
    expect(res.status).toBe(400);
  });

  it("stores password hashes, never plaintext", async () => {
    const m = await createMember("hashy");
    const row = await testEnv.DB.prepare('SELECT password FROM account WHERE "userId" = ?').bind(m.id).first<{ password: string }>();
    expect(row?.password).toMatch(/^pbkdf2_sha256\$100000\$/);
    expect(row?.password).not.toContain(m.password);
  });
});

describe("sign in", () => {
  it("accepts email or username", async () => {
    const m = await createMember("signer");
    const byUsername = await call("/api/auth/sign-in/username", {
      body: { username: m.username.toUpperCase(), password: m.password },
      headers: { "x-turnstile-token": "ok" },
      ip: m.ip,
    });
    expect(byUsername.status).toBe(200);
    expect(cookieFrom(byUsername)).toContain("session_token");
    const wrong = await call("/api/auth/sign-in/email", {
      body: { email: m.email, password: "wrong password!!" },
      headers: { "x-turnstile-token": "ok" },
      ip: m.ip,
    });
    expect(wrong.status).toBe(401);
  });

  it("sets HttpOnly SameSite session cookies", async () => {
    const m = await createMember("cookie");
    const res = await call("/api/auth/sign-in/email", {
      body: { email: m.email, password: m.password },
      headers: { "x-turnstile-token": "ok" },
      ip: m.ip,
    });
    const header = res.headers.getSetCookie().find((h) => h.includes("session_token"))!;
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
  });

  it("rejects private API calls without a session", async () => {
    expect((await call("/api/account/me")).status).toBe(401);
    expect((await call("/api/library")).status).toBe(401);
    expect((await call("/api/clubs")).status).toBe(401);
    expect((await call("/api/home")).status).toBe(401);
  });

  it("blocks Better Auth endpoints that would bypass password confirmation", async () => {
    const m = await createMember("bypass");
    const res = await call("/api/auth/update-user", { body: { username: "hijack" }, cookie: m.cookie, ip: m.ip });
    expect(res.status).toBe(404);
    const email = await call("/api/auth/change-email", { body: { newEmail: "x@example.com" }, cookie: m.cookie, ip: m.ip });
    expect(email.status).toBe(404);
  });

  it("rejects cross-site state-changing requests", async () => {
    const m = await createMember("csrf");
    const res = await call("/api/goals", { method: "PUT", body: { year: 2026, target: 5 }, cookie: m.cookie, ip: m.ip, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("password reset", () => {
  it("returns the same response for known and unknown emails", async () => {
    const m = await createMember("resetter");
    const known = await call("/api/auth/request-password-reset", { body: { email: m.email }, headers: { "x-turnstile-token": "ok" }, ip: nextIp() });
    const unknown = await call("/api/auth/request-password-reset", {
      body: { email: "nobody-here@example.com" },
      headers: { "x-turnstile-token": "ok" },
      ip: nextIp(),
    });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
  });

  it("revokes all sessions after a reset and stores the token hashed", async () => {
    const m = await createMember("revoker");
    await call("/api/auth/request-password-reset", { body: { email: m.email }, headers: { "x-turnstile-token": "ok" }, ip: m.ip });
    const mail = await latestEmail(m.email);
    expect(mail?.subject).toMatch(/Reset your password/);
    const link = new URL(linkIn(mail!.text_body));
    const token = link.pathname.split("/").pop()!;
    // The raw token is not stored in the verification table.
    const stored = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM "verification" WHERE identifier LIKE ? OR value LIKE ?')
      .bind(`%${token}%`, `%${token}%`)
      .first<{ n: number }>();
    expect(stored?.n).toBe(0);

    const reset = await call("/api/auth/reset-password", { body: { newPassword: "a brand new password", token }, ip: m.ip });
    expect(reset.status).toBe(200);
    // Old session no longer works.
    expect((await call("/api/account/me", { cookie: m.cookie, ip: m.ip })).status).toBe(401);
    // New password works, old one does not.
    const oldPw = await call("/api/auth/sign-in/email", { body: { email: m.email, password: m.password }, headers: { "x-turnstile-token": "ok" }, ip: m.ip });
    expect(oldPw.status).toBe(401);
    const newPw = await call("/api/auth/sign-in/email", {
      body: { email: m.email, password: "a brand new password" },
      headers: { "x-turnstile-token": "ok" },
      ip: m.ip,
    });
    expect(newPw.status).toBe(200);
  });
});

describe("rate limiting", () => {
  it("limits repeated sign-in attempts for one account", async () => {
    const m = await createMember("limited");
    let last = 0;
    // Non-production headroom is 10x (200 per 15 minutes per identifier).
    for (let i = 0; i < 205; i++) {
      const res = await call("/api/auth/sign-in/email", {
        body: { email: m.email, password: "wrong password!!" },
        headers: { "x-turnstile-token": "ok" },
        ip: `192.0.2.${i % 200}`,
      });
      last = res.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  }, 30_000); // ~200 sign-in attempts, each hashing a password
});

describe("account changes", () => {
  it("requires the current password to change username or email", async () => {
    const m = await createMember("changer");
    const bad = await call("/api/account/username", { method: "PUT", body: { username: "newhandle_x", currentPassword: "nope nope" }, cookie: m.cookie, ip: m.ip });
    expect(bad.status).toBe(400);
    const good = await call("/api/account/username", {
      method: "PUT",
      body: { username: "NewHandle_Y", currentPassword: m.password },
      cookie: m.cookie,
      ip: m.ip,
    });
    expect(good.status).toBe(200);
    expect((await json(good)).username).toBe("newhandle_y");
    const email = await call("/api/account/email", { body: { newEmail: "changed@example.com", currentPassword: m.password }, cookie: m.cookie, ip: m.ip });
    expect(email.status).toBe(200);
    expect((await latestEmail("changed@example.com"))?.subject).toMatch(/new email/i);
  });

  it("lets a member list and revoke their own sessions only", async () => {
    const a = await createMember("sess_a");
    const b = await createMember("sess_b");
    const sessions = await json<{ id: string; current: boolean }[]>(await call("/api/account/sessions", { cookie: a.cookie, ip: a.ip }));
    expect(sessions.some((s) => s.current)).toBe(true);
    const bSessions = await json<{ id: string }[]>(await call("/api/account/sessions", { cookie: b.cookie, ip: b.ip }));
    const res = await call(`/api/account/sessions/${bSessions[0]!.id}`, { method: "DELETE", cookie: a.cookie, ip: a.ip });
    expect(res.status).toBe(404);
    expect((await call("/api/account/me", { cookie: b.cookie, ip: b.ip })).status).toBe(200);
  });
});

describe("changing password", () => {
  it("keeps this device signed in and signs out the others", async () => {
    const m = await createMember("changer");
    // A second device.
    const other = await call("/api/auth/sign-in/email", { body: { email: m.email, password: m.password }, headers: { "x-turnstile-token": "ok" }, ip: m.ip });
    const otherCookie = cookieFrom(other);
    expect((await call("/api/account/me", { cookie: otherCookie, ip: m.ip })).status).toBe(200);

    const res = await call("/api/account/password", {
      cookie: m.cookie,
      ip: m.ip,
      body: { currentPassword: m.password, newPassword: "a brand new passphrase", confirmPassword: "a brand new passphrase", revokeOtherSessions: true },
    });
    expect(res.status).toBe(200);
    const fresh = cookieFrom(res, m.cookie);
    expect(fresh).not.toBe(m.cookie);
    expect((await call("/api/account/me", { cookie: fresh, ip: m.ip })).status).toBe(200);
    expect((await call("/api/account/me", { cookie: otherCookie, ip: m.ip })).status).toBe(401);
  });

  it("rejects a wrong current password", async () => {
    const m = await createMember("wrongpw");
    const res = await call("/api/account/password", {
      cookie: m.cookie,
      ip: m.ip,
      body: { currentPassword: "not my password at all", newPassword: "a brand new passphrase", confirmPassword: "a brand new passphrase", revokeOtherSessions: false },
    });
    expect(res.status).toBe(400);
    expect((await call("/api/account/me", { cookie: m.cookie, ip: m.ip })).status).toBe(200);
  });
});

describe("encrypted connections", () => {
  it("redirects plain http to https", async () => {
    const res = await worker.fetch(new Request("http://bookclub.example.com/library?tab=tbr"), testEnv, createExecutionContext());
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://bookclub.example.com/library?tab=tbr");
    const post = await worker.fetch(new Request("http://bookclub.example.com/api/health", { method: "POST" }), testEnv, createExecutionContext());
    expect(post.status).toBe(308);
  });

  it("sends HSTS over https", async () => {
    const res = await worker.fetch(new Request("https://bookclub.example.com/api/health"), testEnv, createExecutionContext());
    expect(res.headers.get("strict-transport-security")).toMatch(/max-age=63072000/);
  });
});
