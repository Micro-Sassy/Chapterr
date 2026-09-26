import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { mockFetch, renderRoutes } from "@/test/utils";
import { RegisterPage } from "./Register";
import { safeNext, SignInPage } from "./SignIn";

// Turnstile is exercised end-to-end; here it immediately yields a token.
vi.mock("@/components/Turnstile", async () => {
  const { forwardRef, useEffect } = await import("react");
  return {
    Turnstile: forwardRef<unknown, { onToken: (t: string) => void }>(function Mock({ onToken }, _ref) {
      useEffect(() => onToken("test-token"), [onToken]);
      return null;
    }),
  };
});

describe("SignInPage", () => {
  it("shows validation errors without calling the API", async () => {
    const calls = mockFetch({});
    renderRoutes([{ path: "/sign-in", element: <SignInPage /> }], "/sign-in");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter your email or username")).toBeInTheDocument();
    expect(screen.getByText("Enter your password")).toBeInTheDocument();
    expect(calls.filter((c) => c.path.startsWith("/api/auth/sign-in"))).toHaveLength(0);
  });

  it("signs in by username with the Turnstile token, then redirects to a safe next path", async () => {
    const calls = mockFetch({
      "POST /api/auth/sign-in/username": () => ({ json: { token: "x" } }),
      "GET /api/auth/get-session": () => ({ json: null }),
    });
    const { router } = renderRoutes(
      [
        { path: "/sign-in", element: <SignInPage /> },
        { path: "/library", element: <p>Library page</p> },
      ],
      "/sign-in?next=%2Flibrary",
    );
    await userEvent.type(screen.getByLabelText("Email or username"), "Reader_One");
    await userEvent.type(screen.getByLabelText("Password"), "secret password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/library"));
    const call = calls.find((c) => c.path === "/api/auth/sign-in/username")!;
    expect(call.body).toMatchObject({ username: "Reader_One", password: "secret password" });
    expect(call.headers["x-turnstile-token"]).toBe("test-token");
  });

  it("explains unverified accounts", async () => {
    mockFetch({ "POST /api/auth/sign-in/email": () => ({ status: 403, json: { code: "EMAIL_NOT_VERIFIED", message: "Email not verified" } }) });
    renderRoutes([{ path: "/sign-in", element: <SignInPage /> }], "/sign-in");
    await userEvent.type(screen.getByLabelText("Email or username"), "me@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "whatever pw");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Please confirm your email first")).toBeInTheDocument();
  });

  it("only allows relative redirect targets", () => {
    expect(safeNext("/club")).toBe("/club");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("RegisterPage", () => {
  it("requires the privacy notice and matching passwords", async () => {
    const calls = mockFetch({});
    renderRoutes([{ path: "/register", element: <RegisterPage /> }], "/register");
    await userEvent.type(screen.getByLabelText("Username"), "new_reader");
    await userEvent.type(screen.getByLabelText("Display name"), "New Reader");
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "long enough password");
    await userEvent.type(screen.getByLabelText("Confirm password"), "different password");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Please accept the privacy and use notice")).toBeInTheDocument();
    // Cross-field checks run once every field is individually valid.
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(calls.filter((c) => c.path === "/api/auth/sign-up/email")).toHaveLength(0);
  });

  it("submits a valid registration and routes to the check-email page", async () => {
    const calls = mockFetch({ "POST /api/auth/sign-up/email": () => ({ json: { token: null } }) });
    const { router } = renderRoutes(
      [
        { path: "/register", element: <RegisterPage /> },
        { path: "/check-email", element: <p>Check</p> },
      ],
      "/register",
    );
    await userEvent.type(screen.getByLabelText("Username"), "new_reader");
    await userEvent.type(screen.getByLabelText("Display name"), "New Reader");
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "long enough password");
    await userEvent.type(screen.getByLabelText("Confirm password"), "long enough password");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/check-email"));
    expect(calls.find((c) => c.path === "/api/auth/sign-up/email")?.body).toEqual({
      username: "new_reader",
      name: "New Reader",
      email: "new@example.com",
      password: "long enough password",
      acceptPrivacy: true,
    });
  });
});
