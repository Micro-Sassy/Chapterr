import type { GateType, RoomKind } from "@shared/constants";
import type { ClubReadingProgress } from "@shared/types";

export interface GateLike {
  gateType: GateType;
  gateValue: number | null;
}

/** One line that says when a room opens, in the club's plain voice. */
export function gateLabel(gate: GateLike): string {
  switch (gate.gateType) {
    case "chapter":
      return `Opens at chapter ${gate.gateValue ?? 1}`;
    case "page":
      return `Opens at page ${gate.gateValue ?? 1}`;
    case "percent":
      return `Opens at ${gate.gateValue ?? 0}%`;
    case "finished":
      return "Opens when you finish the book";
    default:
      return "Open to everyone";
  }
}

/** The short reason shown on a locked room, phrased to the reader. */
export function lockedCopy(gate: GateLike): string {
  switch (gate.gateType) {
    case "chapter":
      return `This room opens once you reach chapter ${gate.gateValue ?? 1}. Update your progress when you get there.`;
    case "page":
      return `This room opens once you reach page ${gate.gateValue ?? 1}. Update your progress when you get there.`;
    case "percent":
      return `This room opens once you are ${gate.gateValue ?? 0}% through. Update your progress when you get there.`;
    case "finished":
      return "This room opens once you have finished the book. Mark it finished and come in.";
    default:
      return "This room is not open yet.";
  }
}

/** Client-side mirror of the server gate, used to pick copy before the server answers. */
export function reachedGate(progress: ClubReadingProgress | null | undefined, gate: GateLike): boolean {
  if (gate.gateType === "none") return true;
  if (!progress) return false;
  if (progress.finished) return true;
  if (gate.gateValue === null) return false;
  switch (gate.gateType) {
    case "chapter":
      return (progress.chapter ?? -1) >= gate.gateValue;
    case "page":
      return (progress.page ?? -1) >= gate.gateValue;
    case "percent":
      return (progress.percent ?? -1) >= gate.gateValue;
    case "finished":
      return false;
  }
}

export const ROOM_KIND_LABELS: Record<RoomKind, string> = { chapter: "Chapter", milestone: "Milestone", reflection: "Reflection" };

/** A member's position in one short phrase: "Chapter 5", "Page 120", "48%", "Finished", or "Not started". */
export function progressLabel(p: ClubReadingProgress | null | undefined): string {
  if (!p) return "Not started";
  if (p.finished) return "Finished";
  if (p.chapter !== null && p.chapter !== undefined) return `Chapter ${p.chapter}`;
  if (p.page !== null && p.page !== undefined) return `Page ${p.page}`;
  if (p.percent !== null && p.percent !== undefined) return `${p.percent}%`;
  return "Not started";
}
