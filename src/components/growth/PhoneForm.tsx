import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AccountContact, Me } from "@shared/types";
import { Alert, Button, Checkbox, Field, Input, SectionTitle } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { checkPhone, formatPhone, PHONE_HELP } from "./phone";

export type MeWithContact = Me & Partial<AccountContact>;

/** Phone number + SMS opt-in. SMS is used for meeting reminders only. */
export function PhoneForm({ me }: { me: MeWithContact }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [phone, setPhone] = useState(formatPhone(me.phone));
  const [optIn, setOptIn] = useState(me.smsOptIn ?? false);
  const [touched, setTouched] = useState(false);
  const check = checkPhone(phone);
  const save = useMutation({
    mutationFn: () => api<Me>("/api/account/phone", { method: "PUT", body: { phone: check.normalized || null, smsOptIn: optIn && !!check.normalized } }),
    onSuccess: (data) => {
      qc.setQueryData(["me"], data);
      toast(check.normalized ? "Phone number saved." : "Phone number removed.");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const dirty = check.normalized !== (me.phone ?? "") || optIn !== (me.smsOptIn ?? false);
  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (check.ok) save.mutate();
      }}
    >
      <SectionTitle>Phone and text reminders</SectionTitle>
      <Field label="Mobile number" hint={PHONE_HELP} error={touched && !check.ok ? (check.message ?? undefined) : undefined}>
        {(id, d) => (
          <Input
            id={id}
            aria-describedby={d}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+1 214 555 1234"
            value={phone}
            invalid={touched && !check.ok}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        )}
      </Field>
      <Checkbox
        label="Text me meeting reminders"
        checked={optIn && !!check.normalized}
        disabled={!check.normalized}
        onChange={(e) => setOptIn(e.target.checked)}
      />
      <p className="text-xs text-ink-muted">
        Texts are sent only for meeting reminders, at the times your club sets, and only while this box is ticked. We never text for anything else, and your number is never shown to other members. Carrier rates may apply.
      </p>
      {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      <Button type="submit" loading={save.isPending} disabled={!dirty}>
        Save number
      </Button>
    </form>
  );
}
