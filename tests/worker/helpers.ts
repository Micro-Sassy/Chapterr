import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { vi } from "vitest";
import worker from "../../worker/index";
import type { Env } from "../../worker/env";

export const ORIGIN = "http://localhost";
export const testEnv = env as unknown as Env;

let ipCounter = 1;
/** Each simulated member gets its own client IP so per-IP auth limits don't interfere. */
export function nextIp(): string {
  ipCounter++;
  return `203.0.113.${ipCounter % 250}`;
}

export interface CallOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  headers?: Record<string, string>;
  ip?: string;
  origin?: string | null;
}

export async function call(path: string, opts: CallOptions = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (opts.origin !== null) headers.set("origin", opts.origin ?? ORIGIN);
  headers.set("cf-connecting-ip", opts.ip ?? "198.51.100.1");
  if (opts.cookie) headers.set("cookie", opts.cookie);
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opts.body);
  }
  const request = new Request(`${ORIGIN}${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export async function json<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON (${res.status}): ${text.slice(0, 300)}`);
  }
}

/**
 * Stub outbound fetch: Turnstile passes for any token except "fail";
 * catalogue providers get canned responses registered by the test.
 */
export function installFetchMock(extra?: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined) {
  const real = globalThis.fetch;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://challenges.cloudflare.com/turnstile/")) {
      const form = init?.body as FormData;
      const token = form?.get?.("response");
      return Response.json({ success: token !== "fail" });
    }
    const custom = await extra?.(url, init);
    if (custom) return custom;
    if (url.startsWith("http://localhost") || url.startsWith("https://realtime.internal")) return real(input as RequestInfo, init);
    return new Response("not mocked", { status: 404 });
  });
  return spy;
}

export function cookieFrom(res: Response, existing = ""): string {
  const jar = new Map<string, string>();
  for (const part of existing.split(/;\s*/).filter(Boolean)) {
    const [k, ...v] = part.split("=");
    jar.set(k!, v.join("="));
  }
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const [k, ...v] = pair!.split("=");
    const value = v.join("=");
    if (/max-age=0/i.test(header) || value === "") jar.delete(k!);
    else jar.set(k!, value);
  }
  return Array.from(jar, ([k, v]) => `${k}=${v}`).join("; ");
}

export async function latestEmail(to: string): Promise<{ subject: string; text_body: string } | null> {
  return testEnv.DB.prepare("SELECT subject, text_body FROM dev_outbox WHERE to_address = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .bind(to.toLowerCase())
    .first();
}

export function linkIn(text: string): string {
  const m = /(http:\/\/localhost[^\s]+)/.exec(text);
  if (!m) throw new Error(`No link in email: ${text}`);
  return m[1]!;
}

export interface Member {
  id: string;
  username: string;
  email: string;
  password: string;
  cookie: string;
  ip: string;
}

let seq = 0;
export async function createMember(name = "reader"): Promise<Member> {
  seq++;
  const suffix = `${Date.now().toString(36)}${seq}`;
  const username = `${name}_${suffix}`.slice(0, 30);
  const email = `${username}@example.com`;
  const password = "correct horse battery";
  const ip = nextIp();
  const signup = await call("/api/auth/sign-up/email", {
    body: { name: `${name} ${seq}`, email, password, username, acceptPrivacy: true },
    headers: { "x-turnstile-token": "ok" },
    ip,
  });
  if (signup.status !== 200) throw new Error(`sign-up failed ${signup.status}: ${await signup.text()}`);
  const mail = await latestEmail(email);
  if (!mail) throw new Error("no verification email");
  const link = new URL(linkIn(mail.text_body));
  const verify = await call(link.pathname + link.search, { ip, origin: null });
  if (verify.status >= 400) throw new Error(`verify failed ${verify.status}`);
  const signin = await call("/api/auth/sign-in/email", { body: { email, password }, headers: { "x-turnstile-token": "ok" }, ip });
  if (signin.status !== 200) throw new Error(`sign-in failed ${signin.status}: ${await signin.text()}`);
  const cookie = cookieFrom(signin);
  const me = await json<{ id: string }>(await call("/api/account/me", { cookie, ip }));
  return { id: me.id, username, email, password, cookie, ip };
}

/** Convenience: authenticated request as a member. */
export function as(member: Member) {
  return (path: string, opts: CallOptions = {}) => call(path, { ...opts, cookie: member.cookie, ip: member.ip });
}

export interface TestClub {
  id: string;
  name: string;
  slug: string;
}

/** Create a club owned by `owner` (Turnstile is stubbed by installFetchMock). */
export async function createClub(owner: Member, name = "Test Club"): Promise<TestClub> {
  const res = await as(owner)("/api/clubs", { body: { name }, headers: { "x-turnstile-token": "ok" } });
  if (res.status !== 201) throw new Error(`create club failed ${res.status}: ${await res.text()}`);
  const club = await json<TestClub>(res);
  return { id: club.id, name: club.name, slug: club.slug };
}

/** Create an invite link as an admin/owner and return its code. */
export async function createInvite(admin: Member, clubId: string, body: Record<string, unknown> = {}): Promise<{ id: string; code: string; url: string }> {
  const res = await as(admin)(`/api/clubs/${clubId}/invites`, { body });
  if (res.status !== 201) throw new Error(`create invite failed ${res.status}: ${await res.text()}`);
  return json(res);
}

/** Join a club with an invite code. */
export async function joinClub(member: Member, code: string): Promise<Response> {
  return as(member)("/api/clubs/join", { body: { code }, headers: { "x-turnstile-token": "ok" } });
}

/** Add `member` to `club` through a fresh invite from `admin`. */
export async function addToClub(admin: Member, club: TestClub, member: Member): Promise<void> {
  const invite = await createInvite(admin, club.id);
  const res = await joinClub(member, invite.code);
  if (res.status !== 201 && res.status !== 200) throw new Error(`join failed ${res.status}: ${await res.text()}`);
}

/** Id of the club's main conversation. */
export async function mainConversation(member: Member, clubId: string): Promise<string> {
  const list = await json<{ id: string; kind: string }[]>(await as(member)(`/api/clubs/${clubId}/conversations`));
  const main = list.find((c) => c.kind === "club");
  if (!main) throw new Error("no club conversation");
  return main.id;
}

export async function seedEdition(title = "The Test Book", isbn13: string | null = null): Promise<string> {
  const id = `ed_${Math.random().toString(36).slice(2, 12)}`;
  const bookId = `bk_${Math.random().toString(36).slice(2, 12)}`;
  const now = new Date().toISOString();
  await testEnv.DB.batch([
    testEnv.DB.prepare("INSERT INTO books (id, title, primary_author, work_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
      bookId,
      title,
      "Test Author",
      `${title.toLowerCase()}|test author|${bookId}`,
      now,
      now,
    ),
    testEnv.DB.prepare(
      "INSERT INTO book_editions (id, book_id, isbn13, title, authors, search_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, bookId, isbn13, title, JSON.stringify(["Test Author"]), `${title.toLowerCase()} test author`, now, now),
  ]);
  return id;
}
