import { CalendarClock, X } from "lucide-react";
import type { ScheduledMessage } from "@shared/types";
import { IconButton } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

/** The reader's messages waiting to be sent in this conversation, each with a cancel. */
export function ScheduledList({ items, onCancel, canceling }: { items: ScheduledMessage[]; onCancel: (id: string) => void; canceling?: boolean }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Scheduled messages" className="border-t border-line py-2">
      <p className="label mb-1.5 flex items-center gap-1.5 text-ink-muted">
        <CalendarClock className="size-3.5" aria-hidden /> Scheduled
      </p>
      <ul className="space-y-1">
        {items.map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded-control bg-surface-2 px-3 py-1.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{s.body}</span>
              <time dateTime={s.sendAt} className="block text-xs text-ink-muted">
                Sends {formatDateTime(s.sendAt)}
              </time>
            </span>
            <IconButton icon={X} label={`Cancel scheduled message: ${s.body.slice(0, 40)}`} className="size-8" disabled={canceling} onClick={() => onCancel(s.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
