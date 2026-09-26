import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { z } from "zod";
import { forgotPasswordSchema, resetPasswordSchema } from "@shared/schemas";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { Alert, Button, Field, Input } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { requestPasswordReset, resendVerification, resetPassword } from "@/lib/auth";
import { AuthLayout } from "./AuthLayout";

export function ForgotPasswordPage() {
  const captchaRef = useRef<TurnstileHandle>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    if (!captcha) return setError("Please complete the anti-spam check.");
    try {
      await requestPasswordReset(email, captcha);
      setSent(true);
    } catch (err) {
      captchaRef.current?.reset();
      setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout title="Reset your password" footer={<Link className="text-accent underline" to="/sign-in">Back to sign in</Link>}>
      {sent ? (
        <Alert tone="success" title="Check your email">
          If an account exists for that address, we sent a link to reset the password. The link expires in one hour.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <p className="text-sm text-ink-muted">Enter the email address on your account and we will send you a reset link.</p>
          <Field label="Email" error={form.formState.errors.email?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} type="email" autoComplete="email" {...form.register("email")} />}
          </Field>
          <Turnstile ref={captchaRef} onToken={setCaptcha} action="reset" />
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token");
  const linkError = params.get("error");
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof resetPasswordSchema>>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { password: "", confirmPassword: "" } });

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await resetPassword(token!, password);
      navigate("/sign-in?reset=1", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  if (!token || linkError) {
    return (
      <AuthLayout title="Link expired" footer={<Link className="text-accent underline" to="/forgot-password">Request a new link</Link>}>
        <Alert tone="error">This password reset link is invalid or has expired. Please request a new one.</Alert>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Choose a new password" subtitle="You will be signed out on all devices afterwards.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="New password" error={form.formState.errors.password?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" {...form.register("password")} />}
        </Field>
        <Field label="Confirm new password" error={form.formState.errors.confirmPassword?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" {...form.register("confirmPassword")} />}
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Save new password
        </Button>
      </form>
    </AuthLayout>
  );
}

export function CheckEmailPage() {
  const [params] = useSearchParams();
  const email = params.get("email") ?? "";
  const captchaRef = useRef<TurnstileHandle>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <AuthLayout title="Confirm your email" footer={<Link className="text-accent underline" to="/sign-in">Go to sign in</Link>}>
      <div className="flex flex-col items-center text-center">
        <MailCheck className="mb-3 size-10 text-accent" aria-hidden />
        <p className="text-sm">
          We sent a confirmation link to <strong>{email || "your email address"}</strong>. Open it to activate your account.
        </p>
        <p className="mt-2 text-xs text-ink-muted">It can take a minute to arrive. Check your spam folder too.</p>
      </div>
      {email && (
        <div className="mt-6 space-y-3 border-t border-line pt-4">
          <p className="text-sm font-medium">Didn't get it?</p>
          <Turnstile ref={captchaRef} onToken={setCaptcha} action="resend" />
          <Button
            variant="secondary"
            className="w-full"
            loading={busy}
            disabled={!captcha}
            onClick={async () => {
              setBusy(true);
              try {
                await resendVerification(email, captcha!);
                setStatus("A new link is on its way.");
              } catch (err) {
                setStatus(errorMessage(err));
              } finally {
                captchaRef.current?.reset();
                setBusy(false);
              }
            }}
          >
            Resend confirmation email
          </Button>
          {status && <p role="status" className="text-sm text-ink-muted">{status}</p>}
        </div>
      )}
    </AuthLayout>
  );
}

export function VerifiedPage() {
  const [params] = useSearchParams();
  const error = params.get("error");
  return (
    <AuthLayout title={error ? "Link not valid" : "Email confirmed"}>
      {error ? (
        <Alert tone="error">This confirmation link is invalid or has expired. Sign in to receive a fresh one.</Alert>
      ) : (
        <Alert tone="success">Thanks! Your email address is confirmed.</Alert>
      )}
      <div className="mt-6">
        <Link to={error ? "/sign-in" : "/"} className="inline-flex h-10 w-full items-center justify-center rounded-[var(--radius)] bg-accent px-4 text-sm font-medium text-on-accent">
          {error ? "Go to sign in" : "Open the book club"}
        </Link>
      </div>
    </AuthLayout>
  );
}
