import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import { signInSchema } from "@shared/schemas";
import type { z } from "zod";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { Alert, Button, Field, Input } from "@/components/ui";
import { ApiRequestError, errorMessage } from "@/lib/api";
import { sessionKey, signIn } from "@/lib/auth";
import { AuthLayout } from "./AuthLayout";

type Values = z.infer<typeof signInSchema>;

/** Only allow in-app relative redirects after sign-in. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
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

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setUnverified(false);
    if (!captcha) {
      setError("Please complete the anti-spam check.");
      return;
    }
    try {
      await signIn(values.identifier, values.password, captcha);
      await qc.invalidateQueries({ queryKey: sessionKey });
      navigate(safeNext(params.get("next")), { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 403 && /verif/i.test(`${err.code} ${err.message}`)) {
        setUnverified(true);
      } else if (err instanceof ApiRequestError && err.status === 401) {
        setError("That email/username and password don't match.");
      } else {
        setError(errorMessage(err));
      }
      captchaRef.current?.reset();
    }
  });

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back to the club."
      footer={
        <>
          New here? <Link className="font-medium text-accent underline" to="/register">Create an account</Link>
        </>
      }
    >
      {params.get("reset") === "1" && (
        <div className="mb-4">
          <Alert tone="success">Your password was changed. Please sign in with your new password.</Alert>
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
          <Link to="/forgot-password" className="text-accent underline">
            Forgot password?
          </Link>
        </div>
        <Turnstile ref={captchaRef} onToken={setCaptcha} action="sign-in" />
        {unverified && (
          <Alert tone="warning" title="Please confirm your email first">
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
