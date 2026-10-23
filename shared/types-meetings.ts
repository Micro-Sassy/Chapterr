// Feature wave 2 types owned by the meetings/calendar/polls/pace work (W1/F1).
// Re-exported from shared/types.ts. Keep additive; document in docs/FEATURES-2.md.
import type { MeetingRole, PaceCadence, PollKind, RecurrenceFreq, RsvpStatus, SignupKind } from "./constants";
import type { EditionSummary, MemberSummary } from "./types";

export interface Recurrence {
  freq: RecurrenceFreq;
  interval?: number;
  byDay?: number[];
  byMonthDay?: number;
  nthWeekday?: { n: 1 | 2 | 3 | 4 | 5 | -1; day: number };
  until?: string | null;
  count?: number | null;
}

export interface RsvpSummary {
  going: number;
  maybe: number;
  no: number;
  goingGuests: number;
  mine: RsvpStatus | null;
  myGuests: number;
  deadlinePassed: boolean;
}

export interface RsvpEntry extends MemberSummary {
  status: RsvpStatus;
  guests: number;
  note: string | null;
  updatedAt: string;
}

export interface AttendanceSummary {
  present: number;
  marked: boolean;
  mine: boolean | null;
}

export interface SignupClaim extends MemberSummary {
  note: string | null;
}

export interface SignupItem {
  id: string;
  label: string;
  quantity: number;
  position: number;
  claims: SignupClaim[];
  mine: boolean;
}

export interface SignupList {
  id: string;
  meetingId: string;
  title: string;
  kind: SignupKind;
  items: SignupItem[];
  version: number;
}

export interface MeetingRoles {
  host: MemberSummary | null;
  picker: MemberSummary | null;
  notetaker: MemberSummary | null;
}

export interface MeetingExtras {
  timezone: string | null;
  locationUrl: string | null;
  rsvpDeadline: string | null;
  recurrence: Recurrence | null;
  seriesId: string | null;
  occurrence: { index: number; total: number } | null;
  roles: MeetingRoles;
  notes: string | null;
  copiedFromId: string | null;
  rsvp: RsvpSummary;
  attendance: AttendanceSummary;
}

export interface MeetingDetailExtras extends MeetingExtras {
  rsvps: RsvpEntry[];
  attendees: MemberSummary[];
  signupLists: SignupList[];
}

export interface RoleLedgerEntry extends MemberSummary {
  counts: Record<MeetingRole, number>;
  lastAssignedAt: Partial<Record<MeetingRole, string>>;
}

export interface RoleLedger {
  members: RoleLedgerEntry[];
  suggested: Record<MeetingRole, MemberSummary | null>;
}

export interface MeetingPack {
  meetingId: string;
  generatedAt: string;
  book: EditionSummary | null;
  agenda: { title: string; items: string[] }[];
  questions: string[];
  quotes: { text: string; author: string; location: string | null }[];
  reviews: { author: string; sentiment: string; excerpt: string }[];
  lastNotes: { meetingTitle: string; startsAt: string; notes: string } | null;
  rsvp: RsvpSummary;
  signupGaps: { list: string; item: string; needed: number }[];
}

export interface CalendarItem {
  id: string;
  kind: "meeting" | "assignment" | "poll";
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  link: string;
  edition: EditionSummary | null;
  rsvp: RsvpStatus | null;
}

export interface CalendarMonth {
  month: string;
  items: CalendarItem[];
}

export interface CalendarYear {
  year: number;
  months: { month: string; counts: { meetings: number; assignments: number; polls: number }; items: CalendarItem[] }[];
}

export interface PollOption {
  id: string;
  position: number;
  label: string;
  edition: EditionSummary | null;
  startsAt: string | null;
  endsAt: string | null;
  votes: number;
  voters: MemberSummary[];
  mine: boolean;
}

export interface Poll {
  id: string;
  clubId: string;
  kind: PollKind;
  title: string;
  description: string | null;
  status: "open" | "closed";
  closesAt: string | null;
  allowMultiple: boolean;
  anonymous: boolean;
  meetingId: string | null;
  year: number | null;
  options: PollOption[];
  totalVoters: number;
  winnerOptionId: string | null;
  appliedAt: string | null;
  createdBy: MemberSummary | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PaceScheduleRow {
  dueDate: string;
  fromPage: number;
  toPage: number;
  assignmentId: string | null;
}

export interface PacePlan {
  id: string;
  clubId: string;
  edition: EditionSummary;
  meetingId: string | null;
  startsOn: string;
  endsOn: string;
  totalPages: number;
  cadence: PaceCadence;
  restDays: number[];
  schedule: PaceScheduleRow[];
  personal: { myPage: number; pagesLeft: number; daysLeft: number; pagesPerDay: number; onTrack: boolean } | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReadingRanges {
  pages: { from: number; to: number } | null;
  kindle: { from: number; to: number } | null;
  audio: { from: string; to: string } | null;
}

export interface EditionMapping {
  kind: "kindle" | "audio";
  total: number;
  label: string | null;
  updatedAt: string;
}
