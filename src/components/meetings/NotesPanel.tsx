import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { MeetingDetail } from "@shared/types";
import { Alert, Button, Card, SectionTitle, Textarea } from "@/components/ui";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { clubApi } from "@/components/records";
import { relativeTime } from "@/lib/format";
import { meetingInvalidations, meetingKeys } from "./api";

type Conflict = { theirs: string; version: number; by: string | null; at: string | null } | null;

/**
 * Shared notes for the meeting. Saved when the field loses focus (only when
 * changed). A 409 shows both versions instead of silently overwriting.
 */
export function NotesPanel({ meeting: m, clubId }: { meeting: MeetingDetail; clubId: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState(m.notes ?? "");
  const [version, setVersion] = useState(m.version);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict>(null);
  const lastSaved = useRef(m.notes ?? "");
  const seenVersion = useRef(m.version);

  // A newer copy from the server (someone else saved) replaces an untouched field.
  useEffect(() => {
    if (m.version !== seenVersion.current) {
      seenVersion.current = m.version;
      setVersion(m.version);
      if (text === lastSaved.current) {
        setText(m.notes ?? "");
        lastSaved.current = m.notes ?? "";
      }
    }
  }, [m.version, m.notes, text]);

  const save = useMutation({
    mutationFn: (v: { notes: string; expectedVersion: number }) => api<MeetingDetail>(clubApi(clubId, `/meetings/${m.id}/notes`), { method: "PUT", body: { notes: v.notes || null, expectedVersion: v.expectedVersion } }),
    onSuccess: (updated, v) => {
      lastSaved.current = v.notes;
      seenVersion.current = updated?.version ?? v.expectedVersion + 1;
      setVersion(seenVersion.current);
      setSavedAt(new Date().toISOString());
      setConflict(null);
      qc.setQueryData<MeetingDetail>(meetingKeys.detail(clubId, m.id), (prev) => (prev && updated ? { ...prev, ...updated } : prev));
      for (const k of meetingInvalidations(clubId)) void qc.invalidateQueries({ queryKey: k });
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.status === 409) {
        const cur = (err.current ?? null) as { notes?: string | null; version?: number; updatedBy?: { displayName: string } | null; updatedAt?: string } | null;
        setConflict({ theirs: cur?.notes ?? "", version: cur?.version ?? version + 1, by: cur?.updatedBy?.displayName ?? null, at: cur?.updatedAt ?? null });
      }
    },
  });

  const commit = () => {
    if (text === lastSaved.current || conflict) return;
    save.mutate({ notes: text, expectedVersion: version });
  };

  return (
    <Card>
      <SectionTitle as="h2">Notes</SectionTitle>
      <p className="mb-2 text-sm text-ink-muted">Minutes, decisions, who said what. Saved when you click away. Plain text or simple Markdown.</p>
      {conflict && (
        <Alert tone="warning" title="Someone else saved notes first" className="mb-3">
          <p>
            {conflict.by ?? "Another member"} saved {conflict.at ? relativeTime(conflict.at) : "a moment ago"}. Keep theirs, or save yours over them.
          </p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-control bg-surface p-2 text-xs">{conflict.theirs || "(empty)"}</pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setText(conflict.theirs);
                lastSaved.current = conflict.theirs;
                setVersion(conflict.version);
                setConflict(null);
              }}
            >
              Use theirs
            </Button>
            <Button size="sm" loading={save.isPending} onClick={() => save.mutate({ notes: text, expectedVersion: conflict.version })}>
              Save mine
            </Button>
          </div>
        </Alert>
      )}
      <Textarea aria-label="Meeting notes" rows={8} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} className="font-mono text-sm" />
      <p className="mt-1.5 text-xs text-ink-muted" aria-live="polite">
        {save.isPending ? "Saving…" : save.isError && !conflict ? errorMessage(save.error) : savedAt ? `Saved ${relativeTime(savedAt)}.` : text !== lastSaved.current ? "Unsaved changes." : ""}
      </p>
    </Card>
  );
}
