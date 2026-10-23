import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router";
import { signInSchema } from "@shared/schemas";
import type { Me } from "@shared/types";
import type { z } from "zod";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { Alert, Button, Field, Input, TextLink } from "@/components/ui";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { sessionKey, signIn } from "@/lib/auth";
import { clubPath } from "@/lib/club";
import { AuthLayout } from "./AuthLayout";

type Values = z.infer<typeof signInSchema>;

/** Only allow in-app relative redirects after sign-in. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/** Where to land after signing in: the requested page, else the last club, else home. */
export async function landingAfterSignIn(next: string | null): Promise<string> {
  if (next) return safeNext(next);
  try {
    const me = await api<Me>("/api/account/me");
    if (me.lastClubId && me.clubs.some((c) => c.id === me.lastClubId)) return clubPath(me.lastClubId);
  } catch {
    /* fall through to home */
  }
  return "/";
}

export function SignInPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const captchaRef = useRef<TurnstileHandle>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(signInSchema), defaultValues: { identifier: "", password: "" } });
  const next = params.get("next");

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setUnverified(false);
    if (!captcha) {
      setError("Please complete the anti-spam check.");
      return;
    }
    try {
      await signIn(values.identifier, values.password, captcha);
      const to = await landingAfterSignIn(next);
      await qc.invalidateQueries({ queryKey: sessionKey });
      navigate(to, { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 403 && /verif/i.test(`${err.code} ${err.message}`)) {
        setUnverified(true);
      } else if (err instanceof ApiRequestError && err.status === 401) {
        setError("That email or username and password don't match.");
      } else {
        setError(errorMessage(err));
      }
      captchaRef.current?.reset();
    }
  });

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back to the shelf."
      footer={
        <>
          New here? <TextLink to={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}>Create an account</TextLink>
        </>
      }
    >
      {params.get("reset") === "1" && (
        <div className="mb-4">
          <Alert tone="success">Your password was changed. Sign in with the new one.</Alert>
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email or username" error={form.formState.errors.identifier?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} autoComplete="username" autoCapitalize="none" invalid={!!form.formState.errors.identifier} {...form.register("identifier")} />}
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="current-password" invalid={!!form.formState.errors.password} {...form.register("password")} />}
        </Field>
        <div className="text-right text-sm">
          <TextLink to="/forgot-password">Forgot password?</TextLink>
        </div>
        <Turnstile ref={captchaRef} onToken={setCaptcha} action="sign-in" />
        {unverified && (
          <Alert tone="warning" title="Confirm your email first">
            We just sent a fresh confirmation link to your inbox. Open it, then sign in again.
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
