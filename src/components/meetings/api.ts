import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { RsvpStatus } from "@shared/constants";
import type { Club, ClubMember, ClubSettings, MeetingDetail, MeetingFull, RoleLedger, RsvpSummary } from "@shared/types";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { useClub } from "@/lib/club";
import { safeZone, browserZone } from "@/lib/calendar";
import { clubApi } from "@/components/records";
import { useToast } from "@/components/ui/Toast";

/** Query keys for everything meeting-shaped. Lists share the ["meetings", clubId] prefix so one invalidation refreshes them all. */
export const meetingKeys = {
  lists: (clubId: string) => ["meetings", clubId] as const,
  list: (clubId: string, when: string, from?: string, to?: string) => ["meetings", clubId, when, from ?? "", to ?? ""] as const,
  detail: (clubId: string, meetingId: string) => ["meeting", clubId, meetingId] as const,
  ledger: (clubId: string) => ["role-ledger", clubId] as const,
  pack: (clubId: string, meetingId: string) => ["meeting-pack", clubId, meetingId] as const,
  calendar: (clubId: string) => ["calendar", clubId] as const,
};

/** Everything that should refresh after a meeting changes. */
export const meetingInvalidations = (clubId: string): unknown[][] => [
  [...meetingKeys.lists(clubId)],
  ["meeting", clubId],
  [...meetingKeys.calendar(clubId)],
  [...meetingKeys.ledger(clubId)],
  ["assignments", clubId],
  ["club-dashboard", clubId],
  ["home"],
];

export type MeetingWhen = "upcoming" | "past" | "all";

export function useMeetings(clubId: string, when: MeetingWhen, range?: { from: string; to: string }, archived = false) {
  const qs = new URLSearchParams({ when });
  if (range) {
    qs.set("from", range.from);
    qs.set("to", range.to);
  }
  if (archived) qs.set("archived", "1");
  return useQuery({
    queryKey: [...meetingKeys.list(clubId, when, range?.from, range?.to), archived],
    queryFn: () => api<MeetingFull[]>(clubApi(clubId, `/meetings?${qs.toString()}`)),
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

export function useMeeting(clubId: string, meetingId: string | undefined) {
  return useQuery({
    queryKey: meetingKeys.detail(clubId, meetingId ?? ""),
    queryFn: () => api<MeetingDetail>(clubApi(clubId, `/meetings/${encodeURIComponent(meetingId!)}`)),
    enabled: !!meetingId,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

export function useRoleLedger(clubId: string, enabled = true) {
  return useQuery({ queryKey: meetingKeys.ledger(clubId), queryFn: () => api<RoleLedger>(clubApi(clubId, "/roles/ledger")), enabled });
}

export function useClubMembers(clubId: string, enabled = true) {
  return useQuery({ queryKey: ["club-members", clubId], queryFn: () => api<ClubMember[]>(clubApi(clubId, "/members")), enabled, staleTime: 60_000 });
}

/**
 * The club's settings, when the viewer may read them. Members who cannot read
 * settings still get a usable answer (the fields fall back to null/false).
 */
export function useClubSettings(clubId: string) {
  return useQuery({
    queryKey: ["club-settings", clubId],
    queryFn: () => api<ClubSettings>(clubApi(clubId, "/settings")),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** The club's zone: from the club record when the API includes it, else settings, else the browser. */
export function useClubTimezone(): string {
  const club = useClub() as Club & { timezone?: string | null; settings?: { timezone?: string | null } | null };
  const fromClub = club.timezone ?? club.settings?.timezone ?? null;
  const settings = useClubSettings(club.id);
  return safeZone(fromClub ?? settings.data?.timezone ?? browserZone());
}

// --- RSVP (optimistic) ---------------------------------------------------------------------------

/** Move the viewer's RSVP within a summary without waiting for the server. */
export function applyRsvp(summary: RsvpSummary, status: RsvpStatus, guests: number): RsvpSummary {
  const next = { ...summary };
  if (summary.mine) {
    next[summary.mine] = Math.max(0, next[summary.mine] - 1);
    if (summary.mine === "going") next.goingGuests = Math.max(0, next.goingGuests - summary.myGuests);
  }
  next[status] += 1;
  if (status === "going") next.goingGuests += guests;
  next.mine = status;
  next.myGuests = status === "going" ? guests : 0;
  return next;
}

function patchMeetingCaches(qc: QueryClient, clubId: string, meetingId: string, patch: (m: MeetingFull) => MeetingFull) {
  qc.setQueriesData<MeetingFull[]>({ queryKey: meetingKeys.lists(clubId) }, (prev) => (prev ? prev.map((m) => (m.id === meetingId ? patch(m) : m)) : prev));
  qc.setQueryData<MeetingDetail>(meetingKeys.detail(clubId, meetingId), (prev) => (prev ? (patch(prev) as MeetingDetail) : prev));
  qc.setQueriesData<{ nextMeeting: MeetingFull | null } | undefined>({ queryKey: ["club-dashboard", clubId] }, (prev) =>
    prev?.nextMeeting && prev.nextMeeting.id === meetingId && prev.nextMeeting.rsvp ? { ...prev, nextMeeting: patch(prev.nextMeeting) } : prev,
  );
}

export interface RsvpVars {
  status: RsvpStatus;
  guests?: number;
  note?: string | null;
}

export function useRsvp(clubId: string, meetingId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (v: RsvpVars) => api<MeetingFull>(clubApi(clubId, `/meetings/${meetingId}/rsvp`), { method: "PUT", body: { status: v.status, guests: v.guests ?? 0, note: v.note ?? null } }),
    onMutate: async (v) => {
      await Promise.all([qc.cancelQueries({ queryKey: meetingKeys.lists(clubId) }), qc.cancelQueries({ queryKey: meetingKeys.detail(clubId, meetingId) })]);
      const lists = qc.getQueriesData<MeetingFull[]>({ queryKey: meetingKeys.lists(clubId) });
      const detail = qc.getQueryData<MeetingDetail>(meetingKeys.detail(clubId, meetingId));
      patchMeetingCaches(qc, clubId, meetingId, (m) => ({ ...m, rsvp: applyRsvp(m.rsvp, v.status, v.guests ?? 0) }));
      return { lists, detail };
    },
    onError: (err, _v, ctx) => {
      for (const [key, data] of ctx?.lists ?? []) qc.setQueryData(key, data);
      if (ctx?.detail) qc.setQueryData(meetingKeys.detail(clubId, meetingId), ctx.detail);
      if (err instanceof ApiRequestError && err.code === "rsvp_closed") toast("RSVPs for this meeting have closed.", "error");
      else toast(errorMessage(err), "error");
    },
    onSettled: () => {
      for (const k of meetingInvalidations(clubId)) void qc.invalidateQueries({ queryKey: k });
    },
  });
}

/** Whether the viewer may manage this meeting's attendance and roles. */
export function canManageMeeting(club: Pick<Club, "role">, meeting: Pick<MeetingFull, "roles">, userId: string | undefined): boolean {
  if (club.role === "owner" || club.role === "admin") return true;
  return !!userId && meeting.roles.host?.id === userId;
}

/** Self check-in is open from six hours before to six hours after the start. */
export function attendanceWindowOpen(startsAt: string, now = Date.now()): boolean {
  const start = Date.parse(startsAt);
  return Math.abs(now - start) <= 6 * 3600_000;
}
