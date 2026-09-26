import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export interface SessionData {
  user: { id: string; name: string; email: string; emailVerified: boolean; username: string; image: string | null };
  session: { id: string; expiresAt: string };
}

export const sessionKey = ["session"] as const;

export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async () => {
      try {
        return await api<SessionData | null>("/api/auth/get-session");
      } catch (err) {
        // Offline: keep whatever we knew; the shell still renders.
        if (err instanceof Error && "status" in err && (err as { status: number }).status === 0) throw err;
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

const withCaptcha = (token: string) => ({ "x-turnstile-token": token });

export async function signIn(identifier: string, password: string, captcha: string) {
  const isEmail = identifier.includes("@");
  return api(isEmail ? "/api/auth/sign-in/email" : "/api/auth/sign-in/username", {
    body: isEmail ? { email: identifier.trim(), password, rememberMe: true } : { username: identifier.trim(), password, rememberMe: true },
    headers: withCaptcha(captcha),
  });
}

export async function signUp(
  input: { username: string; displayName: string; email: string; password: string; acceptPrivacy: true },
  captcha: string,
) {
  return api("/api/auth/sign-up/email", {
    body: { username: input.username, name: input.displayName, email: input.email, password: input.password, acceptPrivacy: input.acceptPrivacy },
    headers: withCaptcha(captcha),
  });
}

export async function requestPasswordReset(email: string, captcha: string) {
  return api("/api/auth/request-password-reset", { body: { email }, headers: withCaptcha(captcha) });
}

export async function resendVerification(email: string, captcha: string) {
  return api("/api/auth/send-verification-email", { body: { email }, headers: withCaptcha(captcha) });
}

export async function resetPassword(token: string, newPassword: string) {
  return api("/api/auth/reset-password", { body: { token, newPassword } });
}

export function useSignOut() {
  const qc = useQueryClient();
  return async () => {
    try {
      await api("/api/auth/sign-out", { body: {} });
    } finally {
      qc.clear();
      qc.setQueryData(sessionKey, null);
    }
  };
}
