import { test as base, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/**
 * Stub the Turnstile *browser widget* so tests don't depend on loading
 * challenges.cloudflare.com in the test browser. The stub hands back
 * Cloudflare's documented dummy token; the Worker still verifies it for real
 * against Cloudflare's siteverify API using the Turnstile testing secret.
 */
const TURNSTILE_STUB = `(() => {
  const widgets = {};
  const issue = (id) => setTimeout(() => {
    const w = widgets[id];
    if (!w) return;
    w.input.value = "XXXX.DUMMY.TOKEN.XXXX";
    if (w.opts.callback) w.opts.callback(w.input.value);
  }, 50);
  window.turnstile = {
    render(el, opts) {
      const id = "stub-" + Math.random().toString(36).slice(2);
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "cf-turnstile-response";
      el.appendChild(input);
      widgets[id] = { input, opts };
      issue(id);
      return id;
    },
    reset(id) {
      const w = widgets[id];
      if (w) { w.input.value = ""; issue(id); }
    },
    remove(id) { delete widgets[id]; },
  };
})();`;

export async function stubTurnstile(context: BrowserContext) {
  await context.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: TURNSTILE_STUB }),
  );
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await stubTurnstile(context);
    await use(context);
  },
});
export { expect };

export const PASSWORD = "a long reading password";
export function uniqueUser(prefix: string) {
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const username = `${prefix}_${id}`.slice(0, 30);
  return { username, displayName: `${prefix[0]!.toUpperCase()}${prefix.slice(1)} Tester`, email: `${username}@example.com` };
}

/** Read the most recent development email for an address (dev outbox, console provider only). */
export async function latestLink(request: APIRequestContext, email: string, subject: RegExp): Promise<string> {
  let link: string | null = null;
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/dev/outbox?to=${encodeURIComponent(email)}`);
        const mails = (await res.json()) as { subject: string; text_body: string }[];
        const mail = mails.find((m) => subject.test(m.subject));
        link = mail ? (/(https?:\/\/\S+)/.exec(mail.text_body)?.[1] ?? null) : null;
        return link;
      },
      { timeout: 20_000 },
    )
    .not.toBeNull();
  return link!;
}

/** Wait for Cloudflare's test-key Turnstile widget to auto-solve (it writes a hidden input). */
export async function waitForTurnstile(page: Page) {
  await expect(page.locator('[data-testid="turnstile"] input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 30_000 });
}

/**
 * Create and verify a member through the API (used for the "other" member in
 * multi-user tests). Uses Turnstile's documented dummy token for test keys.
 */
export async function createMemberViaApi(context: BrowserContext, baseURL: string, prefix: string) {
  const user = uniqueUser(prefix);
  const headers = { Origin: baseURL, "x-turnstile-token": "XXXX.DUMMY.TOKEN.XXXX" };
  const signUp = await context.request.post("/api/auth/sign-up/email", {
    headers,
    data: { name: user.displayName, email: user.email, password: PASSWORD, username: user.username, acceptPrivacy: true },
  });
  expect(signUp.ok()).toBeTruthy();
  const link = await latestLink(context.request, user.email, /Confirm your email/);
  await context.request.get(link);
  const signIn = await context.request.post("/api/auth/sign-in/email", { headers, data: { email: user.email, password: PASSWORD } });
  expect(signIn.ok()).toBeTruthy();
  return user;
}
