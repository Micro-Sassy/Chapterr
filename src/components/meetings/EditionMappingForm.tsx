import { useState } from "react";
import { MAPPING_KINDS, type MappingKind } from "@shared/constants";
import type { ReadingRanges } from "@shared/types";
import { useSharedMutation } from "@/components/records";
import { Button, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";

const KIND_LABELS: Record<MappingKind, string> = { kindle: "Kindle locations", audio: "Audiobook length" };

/** "Pages 1 to 120 · Kindle 1 to 1,840 · Audio 0:00 to 3:12:00" */
export function rangesLine(ranges: ReadingRanges | null | undefined, fallback?: string | null): string {
  if (!ranges) return fallback ?? "";
  const parts: string[] = [];
  if (ranges.pages) parts.push(`Pages ${ranges.pages.from} to ${ranges.pages.to}`);
  if (ranges.kindle) parts.push(`Kindle ${ranges.kindle.from.toLocaleString()} to ${ranges.kindle.to.toLocaleString()}`);
  if (ranges.audio) parts.push(`Audio ${ranges.audio.from} to ${ranges.audio.to}`);
  return parts.length ? parts.join(" · ") : fallback ?? "";
}

/**
 * Tell Chapterr how long the Kindle edition or the audiobook is, so page ranges
 * can be shown as locations and timestamps too. Any member may add one.
 */
export function EditionMappingForm({ editionId, missing, onSaved, invalidate }: { editionId: string; missing: MappingKind[]; onSaved?: () => void; invalidate: unknown[][] }) {
  const [kind, setKind] = useState<MappingKind>(missing[0] ?? "kindle");
  const [total, setTotal] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [label, setLabel] = useState("");
  const save = useSharedMutation(
    () => {
      const seconds = (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60;
      return api(`/api/books/editions/${encodeURIComponent(editionId)}/mappings`, { method: "PUT", body: { kind, total: kind === "audio" ? seconds : Number(total) || 0, label: label.trim() || null } });
    },
    [["edition", editionId], ["edition-mappings", editionId], ...invalidate],
    "Mapping saved.",
  );
  const valid = kind === "audio" ? (Number(hours) || 0) * 60 + (Number(minutes) || 0) > 0 : Number(total) > 0;
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-control border border-line bg-surface-2/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate(undefined, { onSuccess: onSaved });
      }}
    >
      <Field label="Edition" className="w-44">
        {(id) => (
          <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as MappingKind)}>
            {MAPPING_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {kind === "kindle" ? (
        <Field label="Last location" className="w-32">
          {(id) => <Input id={id} type="number" inputMode="numeric" min={1} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="4820" />}
        </Field>
      ) : (
        <>
          <Field label="Hours" className="w-20">
            {(id) => <Input id={id} type="number" inputMode="numeric" min={0} max={200} value={hours} onChange={(e) => setHours(e.target.value)} />}
          </Field>
          <Field label="Minutes" className="w-24">
            {(id) => <Input id={id} type="number" inputMode="numeric" min={0} max={59} value={minutes} onChange={(e) => setMinutes(e.target.value)} />}
          </Field>
        </>
      )}
      <Field label="Label (optional)" className="min-w-40 flex-1">
        {(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === "audio" ? "Audible, narrated by…" : "Kindle edition 2019"} maxLength={120} />}
      </Field>
      <Button type="submit" size="sm" variant="secondary" loading={save.isPending} disabled={!valid}>
        Save mapping
      </Button>
    </form>
  );
}
