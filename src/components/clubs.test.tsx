import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { mockFetch, renderRoutes } from "@/test/utils";
import { JoinPage } from "@/routes/clubs/Join";
import { ClubSwitcher } from "./AppShell";

vi.mock("@/components/Turnstile", async () => {
  const { forwardRef, useEffect } = await import("react");
  return {
    Turnstile: forwardRef<unknown, { onToken: (t: string) => void }>(function Mock({ onToken }, _ref) {
      useEffect(() => onToken("test-token"), [onToken]);
      return null;
    }),
  };
});

const session = { user: { id: "u1", name: "Ada", email: "ada@example.com", emailVerified: true, username: "ada", image: null }, session: { id: "s", expiresAt: "" } };
const clubs = [
  { id: "c1", name: "Sunday Readers", slug: "sunday", description: null, role: "owner", memberCount: 4, plan: "beta_free", createdAt: "", joinedAt: "" },
  { id: "c2", name: "Night Shift", slug: "night", description: null, role: "member", memberCount: 9, plan: "beta_free", createdAt: "", joinedAt: "" },
];

describe("ClubSwitcher", () => {
  it("lists the member's clubs with roles, links to each, and closes on Escape", async () => {
    mockFetch({
      "GET /api/auth/get-session": () => ({ json: session }),
      "GET /api/account/me": () => ({ json: { ...session.user, displayName: "Ada", clubs, lastClubId: "c2" } }),
    });
    renderRoutes([{ path: "/c/:clubId", element: <ClubSwitcher collapsed={false} onJoin={() => undefined} /> }], "/c/c1");
    const trigger = await screen.findByRole("button", { name: /Sunday Readers/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Your clubs" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Sunday ReadersOwner", "Night ShiftMember", "Create a club", "Join with a code"]);
    expect(screen.getByRole("menuitem", { name: /Night Shift/ })).toHaveAttribute("href", "/c/c2");
    expect(screen.getByRole("menuitem", { name: /Create a club/ })).toHaveAttribute("href", "/clubs/new");
    await userEvent.keyboard("{Escape}");
    expect(menu).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});

describe("JoinPage", () => {
  const preview = { code: "ABCDEFGH23", club: { id: "c9", name: "Marsh Readers", description: "Fens and fiction", memberCount: 3 }, invitedBy: "Bea", alreadyMember: false, expired: false };

  it("offers sign-in and registration that return to the invite when signed out", async () => {
    mockFetch({
      "GET /api/auth/get-session": () => ({ json: null }),
      "GET /api/invites/ABCDEFGH23": () => ({ json: preview }),
    });
    renderRoutes([{ path: "/join/:code", element: <JoinPage /> }], "/join/ABCDEFGH23");
    expect(await screen.findByRole("heading", { name: "Join Marsh Readers" })).toBeInTheDocument();
    expect(screen.getByText("3 members")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in?next=%2Fjoin%2FABCDEFGH23");
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/register?next=%2Fjoin%2FABCDEFGH23");
    expect(screen.queryByRole("button", { name: "Join club" })).not.toBeInTheDocument();
  });

  it("joins with the Turnstile token when signed in and opens the club", async () => {
    const calls = mockFetch({
      "GET /api/auth/get-session": () => ({ json: session }),
      "GET /api/invites/ABCDEFGH23": () => ({ json: preview }),
      "POST /api/clubs/join": () => ({ status: 201, json: { ...clubs[0], id: "c9", name: "Marsh Readers" } }),
    });
    const { router } = renderRoutes(
      [
        { path: "/join/:code", element: <JoinPage /> },
        { path: "/c/:clubId", element: <p>Club</p> },
      ],
      "/join/ABCDEFGH23",
    );
    const button = await screen.findByRole("button", { name: "Join club" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await waitFor(() => expect(router.state.location.pathname).toBe("/c/c9"));
    const call = calls.find((c) => c.path === "/api/clubs/join")!;
    expect(call.body).toEqual({ code: "ABCDEFGH23" });
    expect(call.headers["x-turnstile-token"]).toBe("test-token");
  });

  it("explains expired invites", async () => {
    mockFetch({
      "GET /api/auth/get-session": () => ({ json: session }),
      "GET /api/invites/ABCDEFGH23": () => ({ json: { ...preview, expired: true } }),
    });
    renderRoutes([{ path: "/join/:code", element: <JoinPage /> }], "/join/ABCDEFGH23");
    expect(await screen.findByText(/This invite has expired/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join club" })).not.toBeInTheDocument();
  });
});
