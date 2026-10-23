import { createMemberViaApi, expect, test } from "./helpers";

test("mobile layout uses bottom navigation and the PWA manifest is valid", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ ...test.info().project.use });
  await createMemberViaApi(ctx, baseURL!, "mobile");
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
  const bottomNav = page.getByRole("navigation", { name: "Main" }).last();
  await expect(bottomNav.getByRole("link", { name: "Library" })).toBeVisible();
  await bottomNav.getByRole("link", { name: "More" }).click();
  await expect(page.getByRole("heading", { name: "More" })).toBeVisible();

  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest.name).toBe("Chapterr");
  expect(manifest.display).toBe("standalone");
  expect(manifest.theme_color).toBe("#1E3A2F");
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
  const robots = await (await page.request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /");
  await ctx.close();
});
