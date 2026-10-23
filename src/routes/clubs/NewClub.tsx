import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { LIMITS } from "@shared/constants";
import { clubCreateSchema, type ClubCreateInput } from "@shared/schemas";
import type { Club } from "@shared/types";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { Alert, Button, Card, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { clubPath } from "@/lib/club";
import { useDocumentTitle } from "@/lib/hooks";

export function NewClubPage() {
  useDocumentTitle("Create a club");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const captchaRef = useRef<TurnstileHandle>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ClubCreateInput>({ resolver: zodResolver(clubCreateSchema), defaultValues: { name: "", description: "" } });
  const create = useMutation({
    mutationFn: (values: ClubCreateInput) => api<Club>("/api/clubs", { body: values, headers: { "x-turnstile-token": captcha ?? "" } }),
    onSuccess: async (club) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["home"] });
      toast(`${club.name} is ready.`);
      navigate(`${clubPath(club.id)}?welcome=1`, { replace: true });
    },
    onError: (err) => {
      captchaRef.current?.reset();
      if (err instanceof ApiRequestError && err.fields) {
        for (const [k, v] of Object.entries(err.fields)) if (k === "name" || k === "description") form.setError(k, { message: v[0] });
      }
      setError(errorMessage(err));
    },
  });
  const e = form.formState.errors;
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="New club" title="Create a club" description="A club is its own space: one shelf, one schedule, one conversation. You'll be its owner and can invite members next." />
      <Card>
        <form
          onSubmit={form.handleSubmit((v) => {
            setError(null);
            if (!captcha) return setError("Please complete the anti-spam check.");
            create.mutate(v);
          })}
          className="space-y-4"
          noValidate
        >
          <Field label="Club name" hint={`${LIMITS.clubNameMin} to ${LIMITS.clubNameMax} characters.`} error={e.name?.message}>
            {(id, d) => <Input id={id} aria-describedby={d} maxLength={LIMITS.clubNameMax} autoFocus invalid={!!e.name} {...form.register("name")} />}
          </Field>
          <Field label="Description" hint="Optional. What the club reads and how often it meets." error={e.description?.message}>
            {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} maxLength={LIMITS.clubDescriptionMax} {...form.register("description")} />}
          </Field>
          <Turnstile ref={captchaRef} onToken={setCaptcha} action="create-club" />
          <p className="text-xs text-ink-muted">Free during the beta. Later, clubs cost $1 a month and we'll tell you well ahead of time.</p>
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" loading={create.isPending}>
            Create club
          </Button>
        </form>
      </Card>
    </div>
  );
}
