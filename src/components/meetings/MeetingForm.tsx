import { useState } from "react";
import type { MeetingScope } from "@shared/types";
import type { EditionSummary, MeetingFull, Recurrence } from "@shared/types";
import { BookPicker, BookRow } from "@/components/books";
import { clubApi, useSharedMutation } from "@/components/records";
import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { api } from "@/lib/api";
import { browserZone, isoToZonedInput, zonedToIso, zoneOptions } from "@/lib/calendar";
import { meetingInvalidations, useClubTimezone } from "./api";
import { RecurrenceBuilder } from "./RecurrenceBuilder";

/**
 * Plan or edit a meeting. Times are entered as wall-clock values in the chosen
 * zone (the club's by default) and sent as instants. Recurring meetings offer a
 * scope chooser when edited.
 */
export function MeetingForm({ clubId, initial, onDone }: { clubId: string; initial?: MeetingFull; onDone: (meeting: MeetingFull) => void }) {
  const clubZone = useClubTimezone();
  const [timezone, setTimezone] = useState(initial?.timezone ?? clubZone);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [startsAt, setStartsAt] = useState(isoToZonedInput(initial?.startsAt, timezone));
  const [endsAt, setEndsAt] = useState(isoToZonedInput(initial?.endsAt, timezone));
  const [location, setLocation] = useState(initial?.location ?? "");
  const [locationUrl, setLocationUrl] = useState(initial?.locationUrl ?? "");
  const [details, setDetails] = useState(initial?.details ?? "");
  const [edition, setEdition] = useState<EditionSummary | null>(initial?.edition ?? null);
  const [rsvpDeadline, setRsvpDeadline] = useState(isoToZonedInput(initial?.rsvpDeadline, timezone));
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  const [autoAssignRoles, setAutoAssignRoles] = useState(true);
  const [scope, setScope] = useState<MeetingScope>("this");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zones = zoneOptions(clubZone, browserZone(), initial?.timezone);

  const changeZone = (next: string) => {
    // Keep the wall-clock values the member typed; only the zone label changes.
    setTimezone(next);
  };

  const save = useSharedMutation(
    () => {
      const body = {
        title: title.trim(),
        startsAt: zonedToIso(startsAt, timezone),
        endsAt: endsAt ? zonedToIso(endsAt, timezone) : null,
        timezone,
        location: location.trim() || null,
        locationUrl: locationUrl.trim() || null,
        details: details.trim() || null,
        editionId: edition?.id ?? null,
        rsvpDeadline: rsvpDeadline ? zonedToIso(rsvpDeadline, timezone) : null,
      };
      return initial
        ? api<MeetingFull>(clubApi(clubId, `/meetings/${initial.id}?scope=${initial.seriesId ? scope : "this"}`), { method: "PUT", body: { ...body, expectedVersion: initial.version } })
        : api<MeetingFull>(clubApi(clubId, "/meetings"), { body: { ...body, recurrence, autoAssignRoles } });
    },
    meetingInvalidations(clubId),
    initial ? "Meeting updated." : recurrence ? "Meetings scheduled." : "Meeting scheduled.",
  );

  const submit = () => {
    if (!title.trim() || !startsAt) return setError("Add a title and a start time.");
    const start = zonedToIso(startsAt, timezone);
    const end = endsAt ? zonedToIso(endsAt, timezone) : null;
    if (!start) return setError("That start time is not valid.");
    if (end && end <= start) return setError("The meeting has to end after it starts.");
    if (locationUrl.trim() && !/^https?:\/\//i.test(locationUrl.trim())) return setError("The link should start with https://");
    setError(null);
    save.mutate(undefined, { onSuccess: (res) => onDone((Array.isArray(res) ? res[0] : res) as MeetingFull) });
  };

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="March meeting" required />}</Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts">{(id) => <Input id={id} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />}</Field>
        <Field label="Ends (optional)">{(id) => <Input id={id} type="datetime-local" min={startsAt || undefined} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />}</Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Time zone" hint={timezone === clubZone ? "The club's zone." : "Times above are read in this zone."}>
          {(id, d) => (
            <Select id={id} aria-describedby={d} value={timezone} onChange={(e) => changeZone(e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="RSVP by (optional)" hint="Replies close at this time.">
          {(id, d) => <Input id={id} aria-describedby={d} type="datetime-local" max={startsAt || undefined} value={rsvpDeadline} onChange={(e) => setRsvpDeadline(e.target.value)} />}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Location">{(id) => <Input id={id} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Community room, Bea's kitchen…" />}</Field>
        <Field label="Map or video link (optional)">{(id) => <Input id={id} type="url" inputMode="url" value={locationUrl} onChange={(e) => setLocationUrl(e.target.value)} placeholder="https://" />}</Field>
      </div>
      <Field label="Details">{(id) => <Textarea id={id} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />}</Field>
      <div className="space-y-2">
        <p className="text-sm font-medium">Book to discuss (optional)</p>
        {edition && <BookRow edition={edition} link={false} />}
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
            {edition ? "Change book" : "Choose book"}
          </Button>
          {edition && (
            <Button size="sm" variant="ghost" onClick={() => setEdition(null)}>
              Remove
            </Button>
          )}
        </div>
      </div>

      {!initial && (
        <>
          <RecurrenceBuilder value={recurrence} onChange={setRecurrence} startsAtLocal={startsAt} timezone={timezone} />
          <Checkbox label="Assign host, picker and note-taker from the rotation (whoever has had the fewest turns)" checked={autoAssignRoles} onChange={(e) => setAutoAssignRoles(e.target.checked)} />
        </>
      )}

      {initial?.seriesId && (
        <fieldset className="space-y-1.5 rounded-control border border-line p-4 text-sm">
          <legend className="px-1 font-medium">Apply changes to</legend>
          <p className="mb-2 text-xs text-ink-muted">The repeat pattern itself cannot change. To reschedule the series, archive it and plan it again.</p>
          {(["this", "future", "all"] as MeetingScope[]).map((s) => (
            <label key={s} className="flex items-center gap-2">
              <input type="radio" name="scope" value={s} checked={scope === s} onChange={() => setScope(s)} />
              {s === "this" ? "This meeting only" : s === "future" ? "This and future meetings" : "Every meeting in the series"}
            </label>
          ))}
        </fieldset>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" loading={save.isPending}>
        {initial ? "Save changes" : "Save meeting"}
      </Button>
      <Dialog open={picking} onClose={() => setPicking(false)} title="Choose a book" wide>
        <BookPicker
          onPick={(e) => {
            setEdition(e);
            setPicking(false);
          }}
        />
      </Dialog>
    </form>
  );
}
