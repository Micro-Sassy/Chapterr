import { ChevronLeft, ChevronRight, Download, FileText, FileSpreadsheet, FileImage, File as FileIcon, Trash2, Utensils, ClipboardList, Presentation, BookOpen, CalendarDays } from "lucide-react";
import { createElement, useEffect, useState, type ReactNode } from "react";
import type { FileKind } from "@shared/constants";
import type { FileRecord, FileUsage, MeetingFull } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { Badge, Button, cx, IconButton, ProgressBar, TextLink } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { clubPath } from "@/lib/club";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatBytes } from "@/lib/upload";
import { FILE_KIND_LABELS } from "./FileUploader";

export function fileIcon(file: Pick<FileRecord, "kind" | "contentType" | "title">) {
  if (file.kind === "recipe") return Utensils;
  if (file.kind === "minutes") return ClipboardList;
  const t = file.contentType;
  if (t.startsWith("image/")) return FileImage;
  if (t === "application/pdf" || t.startsWith("text/") || /word|rtf|opendocument\.text/.test(t)) return FileText;
  if (/sheet|excel|csv/.test(t)) return FileSpreadsheet;
  if (/presentation|powerpoint/.test(t)) return Presentation;
  if (/epub/.test(t)) return BookOpen;
  return FileIcon;
}

export const isPhoto = (f: FileRecord) => f.kind === "photo" || (f.contentType.startsWith("image/") && f.kind !== "banner");

export function StorageBar({ usage, fallback }: { usage: FileUsage | null; fallback: { files: number; bytes: number } }) {
  const files = usage?.files ?? fallback.files;
  const bytes = usage?.bytes ?? fallback.bytes;
  const filesMax = usage?.filesMax ?? 200;
  const bytesMax = usage?.bytesMax ?? 200_000_000;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Storage</span>
        <span className="text-ink-muted">
          {formatBytes(bytes)} of {formatBytes(bytesMax)} · {files} of {filesMax} files
        </span>
      </div>
      <ProgressBar value={bytes} max={bytesMax} label="Club storage used" />
      {!usage && <p className="text-xs text-ink-muted">Counted from the files listed here.</p>}
    </div>
  );
}

function canDelete(file: FileRecord, viewerId: string | undefined, admin: boolean) {
  return admin || (!!viewerId && file.owner?.id === viewerId);
}

// --- Photos ----------------------------------------------------------------------------

export function PhotoGrid({ photos, viewerId, admin, onDelete, deleting }: { photos: FileRecord[]; viewerId?: string; admin: boolean; onDelete: (f: FileRecord) => void; deleting?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const current = open == null ? null : photos[open] ?? null;
  useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setOpen((i) => (i == null ? i : Math.min(photos.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setOpen((i) => (i == null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, photos.length]);
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Photos">
        {photos.map((p, i) => (
          <li key={p.id} className="group relative">
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="block aspect-square w-full overflow-hidden rounded-control border border-line bg-surface-2 focus-visible:outline-2"
              aria-label={`Open ${p.title}`}
            >
              <img src={p.url} alt={p.title} loading="lazy" className="size-full object-cover transition-transform group-hover:scale-[1.02]" />
            </button>
            <p className="mt-1 truncate text-xs text-ink-muted" title={p.title}>
              {p.title}
            </p>
          </li>
        ))}
      </ul>
      <Dialog open={current != null} onClose={() => setOpen(null)} title={current?.title ?? "Photo"} wide>
        {current && (
          <div className="space-y-3">
            <div className="relative flex items-center justify-center rounded-control bg-ground">
              <img src={current.url} alt={current.title} className="max-h-[60dvh] w-auto max-w-full rounded-control object-contain" />
              {photos.length > 1 && (
                <>
                  <IconButton icon={ChevronLeft} label="Previous photo" className="absolute left-2 bg-surface/80" disabled={open === 0} onClick={() => setOpen((i) => Math.max(0, (i ?? 0) - 1))} />
                  <IconButton
                    icon={ChevronRight}
                    label="Next photo"
                    className="absolute right-2 bg-surface/80"
                    disabled={open === photos.length - 1}
                    onClick={() => setOpen((i) => Math.min(photos.length - 1, (i ?? 0) + 1))}
                  />
                </>
              )}
            </div>
            <FileMeta file={current} />
            <div className="flex flex-wrap gap-2">
              <a href={current.url} download={current.title} className="inline-flex h-9 items-center gap-2 rounded-control border border-line bg-surface px-3 text-sm font-semibold hover:bg-surface-2">
                <Download className="size-4" aria-hidden /> Download
              </a>
              {canDelete(current, viewerId, admin) && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  loading={deleting === current.id}
                  onClick={() => {
                    if (confirm(`Delete ${current.title}?`)) {
                      onDelete(current);
                      setOpen(null);
                    }
                  }}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

function FileMeta({ file }: { file: FileRecord }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
      <Badge>{FILE_KIND_LABELS[file.kind]}</Badge>
      <span>{formatBytes(file.size)}</span>
      {file.owner && (
        <span className="inline-flex items-center gap-1">
          · <Avatar member={file.owner} size="xs" /> {file.owner.displayName}
        </span>
      )}
      <span>· {formatDate(file.createdAt)}</span>
    </p>
  );
}

// --- Documents --------------------------------------------------------------------------

export function DocumentRow({ file, viewerId, admin, onDelete, deleting, clubId, extra }: { file: FileRecord; viewerId?: string; admin: boolean; onDelete: (f: FileRecord) => void; deleting?: string; clubId: string; extra?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-surface-2 text-ink-muted">
        {createElement(fileIcon(file), { className: "size-5", "aria-hidden": true, strokeWidth: 1.75 })}
      </span>
      <div className="min-w-0 flex-1">
        <a href={file.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-medium hover:underline">
          {file.title}
        </a>
        <FileMeta file={file} />
        {extra}
      </div>
      <div className="flex items-center gap-1">
        {file.meetingId && (
          <TextLink to={clubPath(clubId, `meetings/${file.meetingId}`)} className="hidden text-xs sm:inline-flex sm:items-center sm:gap-1">
            <CalendarDays className="size-3.5" aria-hidden /> Meeting
          </TextLink>
        )}
        <a href={file.url} download={file.title} className="inline-flex size-10 items-center justify-center rounded-control text-ink-muted hover:bg-surface-2 hover:text-ink" aria-label={`Download ${file.title}`} title="Download">
          <Download className="size-5" aria-hidden />
        </a>
        {canDelete(file, viewerId, admin) && (
          <IconButton icon={Trash2} label={`Delete ${file.title}`} disabled={deleting === file.id} onClick={() => confirm(`Delete ${file.title}?`) && onDelete(file)} />
        )}
      </div>
    </li>
  );
}

/** Documents grouped: minutes under their meeting ("Minutes of <meeting>"), then everything else by kind. */
export function DocumentList({ files, meetings, clubId, viewerId, admin, onDelete, deleting }: { files: FileRecord[]; meetings: MeetingFull[]; clubId: string; viewerId?: string; admin: boolean; onDelete: (f: FileRecord) => void; deleting?: string }) {
  const meetingById = new Map(meetings.map((m) => [m.id, m]));
  const minutes = files.filter((f) => f.kind === "minutes" && f.meetingId);
  const rest = files.filter((f) => !(f.kind === "minutes" && f.meetingId));
  const groups = new Map<string, FileRecord[]>();
  for (const f of minutes) groups.set(f.meetingId!, [...(groups.get(f.meetingId!) ?? []), f]);
  const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => {
    const ma = meetingById.get(a)?.startsAt ?? "";
    const mb = meetingById.get(b)?.startsAt ?? "";
    return mb.localeCompare(ma);
  });
  const byKind = new Map<FileKind, FileRecord[]>();
  for (const f of rest) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  const kindOrder: FileKind[] = ["minutes", "document", "recipe", "attachment", "photo", "banner"];
  const rowProps = { viewerId, admin, onDelete, deleting, clubId };
  return (
    <div className="space-y-6">
      {sortedGroups.map(([meetingId, list]) => {
        const m = meetingById.get(meetingId);
        return (
          <section key={meetingId}>
            <h3 className="heading-s mb-1 flex flex-wrap items-center gap-2">
              Minutes of {m ? m.title : "a meeting"}
              {m && <span className="text-sm font-normal text-ink-muted">{formatDateTime(m.startsAt)}</span>}
            </h3>
            <ul className="divide-y divide-line">
              {list.map((f) => (
                <DocumentRow key={f.id} file={f} {...rowProps} />
              ))}
            </ul>
          </section>
        );
      })}
      {kindOrder
        .filter((k) => byKind.has(k))
        .map((k) => (
          <section key={k}>
            <h3 className={cx("heading-s mb-1", sortedGroups.length === 0 && byKind.size === 1 && "sr-only")}>{k === "minutes" ? "Minutes (no meeting)" : `${FILE_KIND_LABELS[k]}s`}</h3>
            <ul className="divide-y divide-line">
              {byKind.get(k)!.map((f) => (
                <DocumentRow key={f.id} file={f} {...rowProps} />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
