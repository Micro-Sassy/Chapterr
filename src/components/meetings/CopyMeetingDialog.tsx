import { useState } from "react";
import type { MeetingFull, SignupList } from "@shared/types";
import { clubApi, useSharedMutation } from "@/components/records";
import { Alert, Button, Checkbox, Field, Input } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { api } from "@/lib/api";
import { isoToZonedInput, zonedToIso } from "@/lib/calendar";
import { meetingInvalidations } from "./api";

/** Reuse a meeting on a new date, keeping what you choose. */
export function CopyMeetingDialog({ open, onClose, meeting: m, clubId, tz, onCopied }: { open: boolean; onClose: () => void; meeting: MeetingFull & { signupLists?: SignupList[] }; clubId: string; tz: string; onCopied: (created: MeetingFull) => void }) {
  const [startsAt, setStartsAt] = useState(isoToZonedInput(m.startsAt, tz));
  const [keep, setKeep] = useState({ book: true, location: true, details: true, signups: m.signupLists?.length ? true : false });
  const [error, setError] = useState<string | null>(null);
  const copy = useSharedMutation(
    () => api<MeetingFull>(clubApi(clubId, `/meetings/${m.id}/copy`), { body: { startsAt: zonedToIso(startsAt, tz), keep } }),
    meetingInvalidations(clubId),
    "Meeting copied.",
  );
  return (
    <Dialog open={open} onClose={onClose} title="Copy meeting">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!startsAt || !zonedToIso(startsAt, tz)) return setError("Choose a new date and time.");
          setError(null);
          copy.mutate(undefined, { onSuccess: (created) => onCopied(created as MeetingFull) });
        }}
      >
        <Field label="New date and time" hint={`In ${tz.replace(/_/g, " ")}.`}>
          {(id, d) => <Input id={id} aria-describedby={d} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />}
        </Field>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-sm font-medium">Keep</legend>
          <Checkbox label="Book" checked={keep.book} onChange={(e) => setKeep({ ...keep, book: e.target.checked })} />
          <Checkbox label="Location and link" checked={keep.location} onChange={(e) => setKeep({ ...keep, location: e.target.checked })} />
          <Checkbox label="Details" checked={keep.details} onChange={(e) => setKeep({ ...keep, details: e.target.checked })} />
          <Checkbox label="Sign-up lists (items only, no claims)" checked={keep.signups} onChange={(e) => setKeep({ ...keep, signups: e.target.checked })} />
        </fieldset>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" loading={copy.isPending}>
          Copy meeting
        </Button>
      </form>
    </Dialog>
  );
}
