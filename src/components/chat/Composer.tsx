import { CalendarClock, ImagePlus, Send, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { LIMITS, WAVE2_LIMITS } from "@shared/constants";
import type { MemberSummary } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { Alert, Button, cx, Field, IconButton, Input, Textarea } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { errorMessage } from "@/lib/api";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import { useOnline } from "@/lib/hooks";
import { insertMention, mentionQueryAt } from "@/lib/mentions";
import { resizeImage, uploadAttachment } from "./images";
import type { SendInput } from "./useChat";

export const SCHEDULE_MIN_AHEAD_MS = 2 * 60_000;

interface LocalAttachment {
  key: string;
  name: string;
  previewUrl: string;
  progress: number;
  fileId?: string;
  error?: string;
  abort: AbortController;
}

export interface ComposerProps {
  clubId: string;
  members: MemberSummary[];
  onSend: (input: SendInput) => void;
  /** When given, the composer offers to send later. Resolves once the server accepted it. */
  onSchedule?: (body: string, sendAt: string) => Promise<unknown>;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  label?: string;
  allowPhotos?: boolean;
  sending?: boolean;
}

/** Members whose username or a name word starts with the query, best matches first. */
export function filterMembers(members: MemberSummary[], query: string, limit = 6): MemberSummary[] {
  const q = query.toLowerCase();
  const score = (m: MemberSummary) => {
    const u = m.username.toLowerCase();
    if (!q) return 1;
    if (u.startsWith(q)) return 3;
    if (m.displayName.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))) return 2;
    if (u.includes(q)) return 1;
    return 0;
  };
  return members
    .map((m) => ({ m, s: score(m) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.m.username.localeCompare(b.m.username))
    .slice(0, limit)
    .map((x) => x.m);
}

/** The earliest moment a message may be scheduled for, as a datetime-local value. */
export const minScheduleLocal = () => toLocalInput(new Date(Date.now() + SCHEDULE_MIN_AHEAD_MS).toISOString());

/**
 * The message box: Enter sends and Shift+Enter breaks a line; typing `@` offers
 * club members (arrows move, Enter or Tab inserts `@username`); photos are
 * resized on the device, uploaded with progress and attached by id; a message
 * can be scheduled for later.
 */
export function Composer({ clubId, members, onSend, onSchedule, disabled, placeholder, autoFocus, label = "Message", allowPhotos = true, sending }: ComposerProps) {
  const online = useOnline();
  const listId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [sendAt, setSendAt] = useState("");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const pendingCaret = useRef<number | null>(null);

  const suggestions = useMemo(() => (mention ? filterMembers(members, mention.query) : []), [members, mention]);
  const open = !!mention && suggestions.length > 0;

  // Auto-grow up to a few lines.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [text]);

  useEffect(() => {
    if (pendingCaret.current !== null && textarea.current) {
      textarea.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [text]);

  useEffect(() => setActive(0), [mention?.query]);

  const refreshMention = (el: HTMLTextAreaElement) => {
    setMention(mentionQueryAt(el.value, el.selectionStart ?? el.value.length));
  };

  const pick = (member: MemberSummary) => {
    const el = textarea.current;
    if (!el || !mention) return;
    const caret = el.selectionStart ?? el.value.length;
    const next = insertMention(el.value, mention.start, caret, member.username);
    pendingCaret.current = next.caret;
    setText(next.text);
    setMention(null);
    el.focus();
  };

  const uploading = attachments.some((a) => !a.fileId && !a.error);
  const failed = attachments.some((a) => a.error);
  const canSend = !disabled && online && !sending && !uploading && !failed && (text.trim().length > 0 || attachments.some((a) => a.fileId));

  const submit = () => {
    if (!canSend) return;
    const body = text.trim();
    const ready = attachments.filter((a) => a.fileId);
    onSend({ body, attachmentFileIds: ready.map((a) => a.fileId!), localPreviews: ready.map((a) => a.previewUrl) });
    setText("");
    setMention(null);
    setAttachments([]);
    // The optimistic bubble shows these previews briefly; release them a little later.
    const urls = ready.map((a) => a.previewUrl);
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 60_000);
    textarea.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault();
        const chosen = suggestions[active];
        if (chosen) pick(chosen);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const addFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    e.target.value = "";
    const room = WAVE2_LIMITS.attachmentsPerMessage - attachments.length;
    const chosen = files.slice(0, Math.max(0, room));
    const fresh = chosen.map((file) => ({
      file,
      att: {
        key: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        previewUrl: URL.createObjectURL(file),
        progress: 0,
        abort: new AbortController(),
      } satisfies LocalAttachment,
    }));
    setAttachments((prev) => [...prev, ...fresh.map((f) => f.att)]);
    fresh.forEach(({ att, file }) => void upload(att, file));
  };

  const patch = (key: string, p: Partial<LocalAttachment>) => setAttachments((prev) => prev.map((a) => (a.key === key ? { ...a, ...p } : a)));

  const upload = async (att: LocalAttachment, file: File) => {
    try {
      const blob = await resizeImage(file);
      const rec = await uploadAttachment(clubId, blob, file.name, (f) => patch(att.key, { progress: f }), att.abort.signal);
      patch(att.key, { fileId: rec.id, progress: 1 });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      patch(att.key, { error: errorMessage(err) });
    }
  };

  const removeAttachment = (att: LocalAttachment) => {
    att.abort.abort();
    URL.revokeObjectURL(att.previewUrl);
    setAttachments((prev) => prev.filter((a) => a.key !== att.key));
  };

  const openSchedule = () => {
    setSendAt(toLocalInput(new Date(Date.now() + 60 * 60_000).toISOString()));
    setScheduleError(null);
    setScheduleOpen(true);
  };

  const confirmSchedule = async () => {
    if (!onSchedule) return;
    const body = text.trim();
    if (!body) {
      setScheduleError("Write the message first.");
      return;
    }
    const iso = fromLocalInput(sendAt);
    if (!iso || new Date(iso).getTime() < Date.now() + SCHEDULE_MIN_AHEAD_MS) {
      setScheduleError("Choose a time at least 2 minutes from now.");
      return;
    }
    setScheduling(true);
    setScheduleError(null);
    try {
      await onSchedule(body, iso);
      setText("");
      setScheduleOpen(false);
    } catch (err) {
      setScheduleError(errorMessage(err));
    } finally {
      setScheduling(false);
    }
  };

  const activeId = open ? `${listId}-opt-${active}` : undefined;

  return (
    <div className="border-t border-line pt-3">
      {attachments.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Photos to send">
          {attachments.map((a) => (
            <li key={a.key} className="relative size-20 overflow-hidden rounded-control border border-line bg-surface-2">
              <img src={a.previewUrl} alt={a.name} className={cx("size-full object-cover", !a.fileId && "opacity-60")} />
              {!a.fileId && !a.error && (
                <div className="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-[2px] bg-primary/25" role="progressbar" aria-label={`Uploading ${a.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(a.progress * 100)}>
                  <div className="h-full bg-accent" style={{ width: `${Math.round(a.progress * 100)}%` }} />
                </div>
              )}
              {a.error && (
                <p className="absolute inset-x-0 bottom-0 bg-error px-1 py-0.5 text-[10px] font-semibold text-white" role="alert">
                  Upload failed
                </p>
              )}
              <button type="button" onClick={() => removeAttachment(a)} aria-label={`Remove ${a.name}`} className="absolute right-1 top-1 rounded-full bg-primary/80 p-0.5 text-on-primary hover:bg-primary">
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {failed && <Alert tone="error" className="mb-2">One photo did not upload. Remove it to send the rest.</Alert>}
      <form
        className="flex items-end gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {allowPhotos && (
          <>
            <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={addFiles} aria-hidden tabIndex={-1} />
            <IconButton
              icon={ImagePlus}
              label="Add photo"
              className="size-11"
              disabled={disabled || !online || attachments.length >= WAVE2_LIMITS.attachmentsPerMessage}
              onClick={() => fileInput.current?.click()}
            />
          </>
        )}
        <div className="relative min-w-0 flex-1">
          {open && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Members"
              className="absolute bottom-full left-0 z-40 mb-1.5 w-72 max-w-full overflow-hidden rounded-card border border-line bg-surface p-1.5 shadow-float"
            >
              {suggestions.map((m, i) => (
                <li
                  key={m.id}
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(m);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cx("flex cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-1.5", i === active && "bg-surface-2")}
                >
                  <Avatar member={m} size="xs" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-medium">{m.displayName}</span> <span className="text-ink-muted">@{m.username}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Textarea
            ref={textarea}
            aria-label={label}
            aria-autocomplete="list"
            aria-controls={open ? listId : undefined}
            aria-expanded={open}
            aria-activedescendant={activeId}
            rows={1}
            maxLength={LIMITS.messageMax}
            placeholder={placeholder ?? (online ? "Write a message" : "You are offline")}
            disabled={disabled || !online}
            autoFocus={autoFocus}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              refreshMention(e.target);
            }}
            onKeyUp={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) refreshMention(e.currentTarget);
            }}
            onClick={(e) => refreshMention(e.currentTarget)}
            onBlur={() => setTimeout(() => setMention(null), 150)}
            onKeyDown={onKeyDown}
            className="max-h-40 min-h-11 resize-none"
          />
        </div>
        {onSchedule && <IconButton icon={CalendarClock} label="Schedule message" className="size-11" disabled={disabled || !online || !text.trim()} onClick={openSchedule} />}
        <Button type="submit" icon={Send} loading={sending} disabled={!canSend} aria-label="Send message">
          <span className="hidden sm:inline">Send</span>
        </Button>
      </form>
      {onSchedule && (
        <Dialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} title="Send later">
          <div className="space-y-4">
            <p className="line-clamp-3 rounded-control bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap">{text.trim()}</p>
            <Field label="Send at" hint="At least 2 minutes from now, in your local time. Scheduled messages are text only.">
              {(id, d) => <Input id={id} type="datetime-local" aria-describedby={d} min={minScheduleLocal()} value={sendAt} onChange={(e) => setSendAt(e.target.value)} />}
            </Field>
            {scheduleError && <Alert tone="error">{scheduleError}</Alert>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setScheduleOpen(false)}>
                Cancel
              </Button>
              <Button icon={CalendarClock} loading={scheduling} onClick={() => void confirmSchedule()}>
                Schedule
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
