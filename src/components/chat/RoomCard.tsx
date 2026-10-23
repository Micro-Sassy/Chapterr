import { DoorOpen, Lock, MessageSquare, Users } from "lucide-react";
import type { DiscussionRoom } from "@shared/types";
import { Badge, cx } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { gateLabel, ROOM_KIND_LABELS } from "./gate";

/**
 * One discussion room. Locked rooms show their gate and cannot be opened; the
 * card never reveals what is said inside.
 */
export function RoomCard({ room, onOpen, active }: { room: DiscussionRoom; onOpen: (room: DiscussionRoom) => void; active?: boolean }) {
  const locked = !room.unlocked;
  const gate = gateLabel(room);
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="label text-ink-muted">{ROOM_KIND_LABELS[room.kind]}</p>
          <h3 className="heading-s mt-0.5 truncate">{room.title}</h3>
        </div>
        <span className={cx("inline-flex size-9 shrink-0 items-center justify-center rounded-full border", locked ? "border-line bg-surface-2 text-ink-muted" : "border-primary bg-primary text-on-primary")}>
          {locked ? <Lock className="size-4" aria-hidden strokeWidth={1.75} /> : <DoorOpen className="size-4" aria-hidden strokeWidth={1.75} />}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-muted">{locked ? gate : room.gateType === "none" ? "Open to everyone" : `Open · ${gate.replace(/^Opens /, "opens ")}`}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <Badge>
          <Users className="size-3" aria-hidden /> {room.membersInside} inside
        </Badge>
        <Badge>
          <MessageSquare className="size-3" aria-hidden /> {room.messageCount} {room.messageCount === 1 ? "message" : "messages"}
        </Badge>
        {!locked && room.lastMessageAt && <span>Last {relativeTime(room.lastMessageAt)}</span>}
      </div>
    </>
  );
  if (locked) {
    return (
      <li>
        <div aria-disabled="true" aria-label={`${room.title}, locked. ${gate}`} className="h-full rounded-card border border-dashed border-line bg-surface/60 p-4 text-left opacity-80">
          {content}
        </div>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(room)}
        aria-current={active ? "true" : undefined}
        aria-label={`Open ${room.title}`}
        className={cx("h-full w-full rounded-card border bg-surface p-4 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]", active ? "border-ink" : "border-line")}
      >
        {content}
      </button>
    </li>
  );
}
