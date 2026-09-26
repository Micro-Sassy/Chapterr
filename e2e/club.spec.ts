import { createMemberViaApi, expect, latestLink, PASSWORD, stubTurnstile, test, uniqueUser, waitForTurnstile } from "./helpers";

test("member journey: register, verify, library, review, club list, realtime chat and public share", async ({ page, browser, baseURL }) => {
  const user = uniqueUser("alice");

  // --- Registration with Turnstile and email verification -----------------------
  await page.goto("/register");
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Display name").fill(user.displayName);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByLabel(/privacy and use notice/).check();
  await waitForTurnstile(page);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Confirm your email" })).toBeVisible();

  // Unverified accounts cannot use the app.
  await page.goto("/library");
  await expect(page).toHaveURL(/\/sign-in/);

  const verifyLink = await latestLink(page.request, user.email, /Confirm your email/);
  await page.goto(verifyLink);
  await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
  await page.getByRole("link", { name: "Open the book club" }).click();
  await expect(page.getByText("Welcome back,")).toBeVisible();

  // --- Add a book manually and shelve it ----------------------------------------------
  const title = `The Quiet Ridge ${Date.now()}`;
  await page.goto("/books/add");
  await page.getByRole("button", { name: /Add a book manually/ }).click();
  const dialog = page.getByRole("dialog", { name: "Add a book manually" });
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByLabel("Authors").fill("Jo Rivers");
  await dialog.getByLabel("Pages").fill("240");
  await dialog.getByRole("button", { name: "Add book" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page.getByRole("button", { name: "Add to my library" }).click();
  const shelf = page.getByRole("dialog", { name: "My shelf" });
  await shelf.getByLabel("Status").selectOption("reading");
  await shelf.getByLabel("Progress %").fill("25");
  await shelf.getByLabel("Personal notes").fill("Private thoughts");
  await shelf.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "On my shelf: Reading" })).toBeVisible();

  // --- Review -------------------------------------------------------------------------------
  await page.getByRole("button", { name: "Write a review" }).click();
  const reviewDialog = page.getByRole("dialog", { name: "Write a review" });
  await reviewDialog.getByText("Loved it").click();
  await reviewDialog.getByLabel("Your review").fill("A gentle, clever book about home.");
  await reviewDialog.getByRole("button", { name: "Save review" }).click();
  await expect(page.getByText("A gentle, clever book about home.")).toBeVisible();

  // --- Shared club list -------------------------------------------------------------------------
  await page.getByRole("button", { name: "Club list" }).click();
  await page.getByRole("dialog", { name: /annual list/ }).getByRole("button", { name: "Add to club list" }).click();
  await page.goto("/club");
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  // --- Realtime club chat between two members ------------------------------------------------------
  const bobContext = await browser.newContext();
  const bob = await createMemberViaApi(bobContext, baseURL!, "bob");
  const bobPage = await bobContext.newPage();
  await bobPage.goto("/messages/club");
  await expect(bobPage.getByText("Live")).toBeVisible();

  await page.goto("/messages/club");
  await expect(page.getByText("Live")).toBeVisible();
  const text = `Hello from Alice ${Date.now()}`;
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByLabel("Message", { exact: true }).press("Enter");
  // Delivered to Bob over WebSocket without reloading.
  await expect(bobPage.getByText(text)).toBeVisible();

  // Alice removes her message; Bob sees the neutral placeholder.
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Remove message" }).last().click();
  await expect(bobPage.getByText("Message removed").last()).toBeVisible();
  await expect(bobPage.getByText(text)).toHaveCount(0);

  // Bob can see Alice's profile but not her private notes.
  await bobPage.goto(`/members/${user.username}`);
  await expect(bobPage.getByRole("heading", { name: user.displayName })).toBeVisible();
  await expect(bobPage.getByText("Private thoughts")).toHaveCount(0);
  expect(bob.username).toBeTruthy();

  // --- Public share link --------------------------------------------------------------------------
  await page.goto("/reviews?scope=mine");
  await page.getByRole("tab", { name: "My reviews" }).click();
  await page.getByRole("button", { name: "Share publicly" }).first().click();
  const shareDialog = page.getByRole("dialog", { name: "Share publicly" });
  await waitForTurnstile(page);
  await shareDialog.getByRole("button", { name: "Create link" }).click();
  const url = await shareDialog.getByLabel("Share link").inputValue();
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]+$/);

  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(url);
  await expect(anonPage.getByText("A gentle, clever book about home.")).toBeVisible();
  await expect(anonPage.getByText(user.email)).toHaveCount(0);
  // Anonymous visitors cannot reach chats or member pages.
  await anonPage.goto("/messages/club");
  await expect(anonPage).toHaveURL(/\/sign-in/);
  const api = await anon.request.get("/api/conversations/club/messages");
  expect(api.status()).toBe(401);

  await bobContext.close();
  await anon.close();
});

test("password reset signs out existing sessions", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext();
  const user = await createMemberViaApi(ctx, baseURL!, "reset");
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByText("Welcome back,")).toBeVisible();

  const other = await browser.newContext();
  await stubTurnstile(other);
  const resetPage = await other.newPage();
  await resetPage.goto("/forgot-password");
  await resetPage.getByLabel("Email").fill(user.email);
  await waitForTurnstile(resetPage);
  await resetPage.getByRole("button", { name: "Send reset link" }).click();
  await expect(resetPage.getByText("Check your email")).toBeVisible();

  const link = await latestLink(other.request, user.email, /Reset your password/);
  await resetPage.goto(link);
  await expect(resetPage.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await resetPage.getByLabel("New password", { exact: true }).fill("an entirely new password");
  await resetPage.getByLabel("Confirm new password").fill("an entirely new password");
  await resetPage.getByRole("button", { name: "Save new password" }).click();
  await expect(resetPage).toHaveURL(/\/sign-in\?reset=1/);

  // The original session is gone.
  await page.goto("/library");
  await expect(page).toHaveURL(/\/sign-in/);

  // Sign in with username and the new password.
  await resetPage.getByLabel("Email or username").fill(user.username);
  await resetPage.getByLabel("Password").fill("an entirely new password");
  await waitForTurnstile(resetPage);
  await resetPage.getByRole("button", { name: "Sign in" }).click();
  await expect(resetPage.getByText("Welcome back,")).toBeVisible();
  await ctx.close();
  await other.close();
});
