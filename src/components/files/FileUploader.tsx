import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, X } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";
import { FILE_KINDS, WAVE2_LIMITS, type FileKind } from "@shared/constants";
import type { FileRecord, MeetingFull } from "@shared/types";
import { clubApi } from "@/components/records";
import { Alert, Button, buttonClass, cx, Field, Input, ProgressBar, Select } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { formatBytes, isImageFile, resizeImageFile, uploadFile } from "@/lib/upload";

export const FILE_KIND_LABELS: Record<FileKind, string> = {
  document: "Document",
  photo: "Photo",
  recipe: "Recipe",
  minutes: "Minutes",
  banner: "Banner",
  attachment: "Attachment",
};

/** Kinds a member can pick on the Files page (banners and chat attachments are set elsewhere). */
export const PICKABLE_KINDS = FILE_KINDS.filter((k) => k !== "banner" && k !== "attachment") as FileKind[];

const ACCEPT = "image/*,.pdf,.doc,.docx,.txt,.md,.rtf,.odt,.xls,.xlsx,.csv,.ppt,.pptx,.epub";

interface QueuedFile {
  id: string;
  file: File;
  progress: number;
  status: "waiting" | "uploading" | "done" | "failed";
  error?: string;
}

export function FileUploader({
  clubId,
  meetings,
  maxBytes,
  defaultKind = "document",
  defaultMeetingId = "",
  onUploaded,
}: {
  clubId: string;
  meetings?: MeetingFull[];
  maxBytes: number;
  defaultKind?: FileKind;
  defaultMeetingId?: string;
  onUploaded?: (file: FileRecord) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<FileKind>(defaultKind);
  const [meetingId, setMeetingId] = useState(defaultMeetingId);
  const [title, setTitle] = useState("");
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragging, setDragging] = useState(false);

  const patch = (id: string, p: Partial<QueuedFile>) => setQueue((q) => q.map((f) => (f.id === id ? { ...f, ...p } : f)));

  const upload = useMutation({
    mutationFn: async (item: QueuedFile) => {
      patch(item.id, { status: "uploading", progress: 0 });
      const prepared = isImageFile(item.file) ? await resizeImageFile(item.file, 2000) : item.file;
      if (prepared.size > maxBytes) throw new Error(`${item.file.name} is ${formatBytes(prepared.size)}; the limit is ${formatBytes(maxBytes)}.`);
      const guessedKind: FileKind = kind === "document" && isImageFile(prepared) ? "photo" : kind;
      return uploadFile<FileRecord>(clubApi(clubId, "/files"), prepared, {
        fields: { kind: guessedKind, title: title || undefined, meetingId: meetingId || undefined },
        onProgress: (f) => patch(item.id, { progress: f }),
      });
    },
    onSuccess: (rec, item) => {
      patch(item.id, { status: "done", progress: 1 });
      void qc.invalidateQueries({ queryKey: ["club-files", clubId] });
      void qc.invalidateQueries({ queryKey: ["club-files-usage", clubId] });
      onUploaded?.(rec);
      setTimeout(() => setQueue((q) => q.filter((f) => f.id !== item.id)), 1500);
    },
    onError: (err, item) => {
      patch(item.id, { status: "failed", error: errorMessage(err) });
      toast(errorMessage(err), "error");
    },
  });

  const enqueue = (files: FileList | File[] | null) => {
    if (!files) return;
    const items: QueuedFile[] = Array.from(files).map((file) => ({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, file, progress: 0, status: "waiting" }));
    if (!items.length) return;
    setQueue((q) => [...q, ...items]);
    (async () => {
      for (const item of items) {
        try {
          await upload.mutateAsync(item);
        } catch {
          /* reported per item */
        }
      }
      setTitle("");
    })();
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    enqueue(e.dataTransfer.files);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Kind">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as FileKind)}>
              {PICKABLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {FILE_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Title" hint="Optional. The file name is used otherwise.">
          {(id, d) => <Input id={id} aria-describedby={d} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        {meetings && meetings.length > 0 && (
          <Field label="Meeting" hint="Minutes and photos can belong to a meeting.">
            {(id, d) => (
              <Select id={id} aria-describedby={d} value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
                <option value="">No meeting</option>
                {meetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} · {formatDateTime(m.startsAt)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          "flex flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragging ? "border-ink bg-surface-2" : "border-line",
        )}
      >
        <Upload className="size-6 text-ink-muted" aria-hidden strokeWidth={1.75} />
        <p className="text-sm text-ink-muted">Drop files here, or</p>
        <label htmlFor={inputId} className={buttonClass("secondary", "md", "cursor-pointer")}>
          <Upload className="size-4" aria-hidden /> Choose files
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            enqueue(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-xs text-ink-muted">
          Up to {formatBytes(maxBytes)} per file. Photos are resized to 2000px before upload. {WAVE2_LIMITS.filesPerClub} files per club.
        </p>
      </div>
      {queue.length > 0 && (
        <ul className="space-y-2" aria-label="Uploads">
          {queue.map((q) => (
            <li key={q.id} className="rounded-control border border-line bg-surface p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{q.file.name}</span>
                <span className="text-xs text-ink-muted">
                  {q.status === "done" ? "Uploaded" : q.status === "failed" ? "Failed" : q.status === "uploading" ? `${Math.round(q.progress * 100)}%` : "Waiting"}
                </span>
                {q.status === "failed" && (
                  <Button size="sm" variant="ghost" icon={X} aria-label={`Dismiss ${q.file.name}`} onClick={() => setQueue((list) => list.filter((f) => f.id !== q.id))} />
                )}
              </div>
              {q.status !== "failed" && (
                <div className="mt-2">
                  <ProgressBar value={Math.round(q.progress * 100)} max={100} label={`Uploading ${q.file.name}`} />
                </div>
              )}
              {q.error && (
                <Alert tone="error" className="mt-2">
                  {q.error}
                </Alert>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
