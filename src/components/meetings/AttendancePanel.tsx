import { useQueryClient } from "@tanstack/react-query";
import { Check, UserCheck } from "lucide-react";
import { useState } from "react";
import type { MeetingDetail } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { clubApi, useSharedMutation } from "@/components/records";
import { Button, Card, Checkbox, SectionTitle, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { attendanceWindowOpen, meetingInvalidations, meetingKeys, useClubMembers } from "./api";

/**
 * Admins and the host tick people off (prefilled from "Going"); everyone else
 * can check themselves in around the start time.
 */
export function AttendancePanel({ meeting: m, clubId, canManage }: { meeting: MeetingDetail; clubId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const members = useClubMembers(clubId, canManage);
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const prefill = () => new Set(m.attendance.marked ? m.attendees.map((a) => a.id) : m.rsvps.filter((r) => r.status === "going").map((r) => r.id));
  const selected = draft ?? prefill();
  const save = useSharedMutation((userIds: string[]) => api(clubApi(clubId, `/meetings/${m.id}/attendance`), { method: "PUT", body: { userIds } }), meetingInvalidations(clubId), "Attendance saved.");
  const checkIn = useSharedMutation(() => api(clubApi(clubId, `/meetings/${m.id}/attendance/me`), { method: "POST" }), meetingInvalidations(clubId), "You're checked in.");
  const windowOpen = attendanceWindowOpen(m.startsAt);
  const past = Date.parse(m.startsAt) < new Date().getTime();

  return (
    <Card>
      <SectionTitle as="h2">Attendance</SectionTitle>
      <p className="text-sm text-ink-muted">
        {m.attendance.marked ? `${m.attendance.present} ${m.attendance.present === 1 ? "member" : "members"} attended.` : past ? "Not marked yet." : "Marked at the meeting."}
      </p>
      {!canManage && (
        <div className="mt-3">
          {m.attendance.mine ? (
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Check className="size-4 text-success" aria-hidden /> You're checked in.
            </p>
          ) : windowOpen ? (
            <Button size="sm" icon={UserCheck} loading={checkIn.isPending} onClick={() => checkIn.mutate(undefined)}>
              I'm here
            </Button>
          ) : (
            <p className="text-xs text-ink-muted">Check-in opens six hours before the meeting.</p>
          )}
        </div>
      )}
      {canManage && (
        <div className="mt-3 space-y-3">
          {members.isPending && <Spinner />}
          {members.data && (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {members.data.map((member) => (
                <li key={member.id}>
                  <Checkbox
                    label={
                      <span className="flex items-center gap-2">
                        <Avatar member={member} size="xs" /> {member.displayName}
                      </span>
                    }
                    checked={selected.has(member.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(member.id);
                      else next.delete(member.id);
                      setDraft(next);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={save.isPending}
              onClick={() =>
                save.mutate(Array.from(selected), {
                  onSuccess: () => {
                    setDraft(null);
                    void qc.invalidateQueries({ queryKey: meetingKeys.detail(clubId, m.id) });
                  },
                })
              }
            >
              Save attendance
            </Button>
            {draft && (
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Reset
              </Button>
            )}
            <span className="self-center text-xs text-ink-muted">{selected.size} selected</span>
          </div>
        </div>
      )}
    </Card>
  );
}
