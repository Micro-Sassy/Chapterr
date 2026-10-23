import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import { registerSchema, type RegisterInput } from "@shared/schemas";
import { LIMITS } from "@shared/constants";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { Alert, Button, Checkbox, Field, Input, TextLink } from "@/components/ui";
import { ApiRequestError, errorMessage } from "@/lib/api";
import { signUp } from "@/lib/auth";
import { AuthLayout } from "./AuthLayout";

export function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next");
  const captchaRef = useRef<TurnstileHandle>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { username: "", displayName: "", email: "", password: "", confirmPassword: "", acceptPrivacy: false as unknown as true },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    if (!captcha) {
      setError("Please complete the anti-spam check.");
      return;
    }
    try {
      await signUp({ username: values.username, displayName: values.displayName, email: values.email, password: values.password, acceptPrivacy: true }, captcha);
      navigate(`/check-email?email=${encodeURIComponent(values.email)}`, { replace: true });
    } catch (err) {
      captchaRef.current?.reset();
      if (err instanceof ApiRequestError && /username/i.test(err.message)) {
        form.setError("username", { message: "That username is taken or not allowed" });
        return;
      }
      if (err instanceof ApiRequestError && err.fields) {
        for (const [k, v] of Object.entries(err.fields)) {
          const key = k === "name" ? "displayName" : k;
          if (key in values) form.setError(key as keyof RegisterInput, { message: v[0] });
        }
      }
      setError(errorMessage(err));
    }
  });

  return (
    <AuthLayout
      title="Create your account"
      subtitle={next?.startsWith("/join/") ? "One account, every club you read with. You'll be taken back to your invite." : "One account, every club you read with."}
      footer={
        <>
          Already have one? <TextLink to={next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"}>Sign in</TextLink>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Username" hint="Your handle: letters, numbers and underscores." error={errors.username?.message}>
          {(id, d) => (
            <Input id={id} aria-describedby={d} autoComplete="username" autoCapitalize="none" maxLength={LIMITS.usernameMax} invalid={!!errors.username} {...form.register("username")} />
          )}
        </Field>
        <Field label="Display name" hint="How members of your clubs will see you." error={errors.displayName?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} autoComplete="name" invalid={!!errors.displayName} {...form.register("displayName")} />}
        </Field>
        <Field label="Email" error={errors.email?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} type="email" autoComplete="email" invalid={!!errors.email} {...form.register("email")} />}
        </Field>
        <Field label="Password" hint={`At least ${LIMITS.passwordMin} characters. A short phrase works well.`} error={errors.password?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" invalid={!!errors.password} {...form.register("password")} />}
        </Field>
        <Field label="Confirm password" error={errors.confirmPassword?.message}>
          {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" invalid={!!errors.confirmPassword} {...form.register("confirmPassword")} />}
        </Field>
        <div>
          <Checkbox
            label={
              <>
                I have read the{" "}
                <Link to="/privacy" target="_blank" className="font-medium underline">
                  privacy and use notice
                </Link>{" "}
                and the{" "}
                <Link to="/terms" target="_blank" className="font-medium underline">
                  terms
                </Link>
                , and agree to them.
              </>
            }
            {...form.register("acceptPrivacy")}
          />
          {errors.acceptPrivacy && (
            <p role="alert" className="mt-1 text-xs font-medium text-error">
              {errors.acceptPrivacy.message}
            </p>
          )}
        </div>
        <Turnstile ref={captchaRef} onToken={setCaptcha} action="register" />
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
