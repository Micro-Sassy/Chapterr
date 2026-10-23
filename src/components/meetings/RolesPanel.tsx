import { Scale } from "lucide-react";
import { useState } from "react";
import { MEETING_ROLE_LABELS, MEETING_ROLES, type MeetingRole } from "@shared/constants";
import type { MeetingDetail } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { MemberLink } from "@/components/content";
import { clubApi, useSharedMutation } from "@/components/records";
import { Badge, Button, Card, cx, Field, SectionTitle, Select, Spinner } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { meetingInvalidations, useClubMembers, useRoleLedger } from "./api";

/** Host, picker and note-taker, with the fairness ledger behind a drawer. */
export function RolesPanel({ meeting: m, clubId, canManage }: { meeting: MeetingDetail; clubId: string; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [draft, setDraft] = useState<Record<MeetingRole, string>>({ host: m.roles.host?.id ?? "", picker: m.roles.picker?.id ?? "", notetaker: m.roles.notetaker?.id ?? "" });
  const members = useClubMembers(clubId, canManage && editing);
  const ledger = useRoleLedger(clubId, ledgerOpen || (canManage && editing));
  const save = useSharedMutation(
    (roles: Record<MeetingRole, string>) => api(clubApi(clubId, `/meetings/${m.id}/roles`), { method: "PUT", body: { host: roles.host || null, picker: roles.picker || null, notetaker: roles.notetaker || null } }),
    meetingInvalidations(clubId),
    "Roles saved.",
  );
  const useSuggested = () => {
    if (!ledger.data) return;
    setDraft({ host: ledger.data.suggested.host?.id ?? draft.host, picker: ledger.data.suggested.picker?.id ?? draft.picker, notetaker: ledger.data.suggested.notetaker?.id ?? draft.notetaker });
  };
  return (
    <Card>
      <SectionTitle
        as="h2"
        action={
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" icon={Scale} onClick={() => setLedgerOpen(true)}>
              Fairness
            </Button>
            {canManage && !editing && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setDraft({ host: m.roles.host?.id ?? "", picker: m.roles.picker?.id ?? "", notetaker: m.roles.notetaker?.id ?? "" });
                  setEditing(true);
                }}
              >
                Assign
              </Button>
            )}
          </div>
        }
      >
        Roles
      </SectionTitle>
      {!editing && (
        <ul className="grid gap-3 sm:grid-cols-3">
          {MEETING_ROLES.map((role) => {
            const member = m.roles[role];
            return (
              <li key={role} className="flex items-center gap-2">
                <Avatar member={member} size="sm" />
                <span className="min-w-0">
                  <span className="label block text-ink-muted">{MEETING_ROLE_LABELS[role]}</span>
                  {member ? <MemberLink member={member} className="text-sm font-medium" /> : <span className="text-sm text-ink-muted">Open</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(draft, { onSuccess: () => setEditing(false) });
          }}
        >
          {members.isPending && <Spinner />}
          <div className="grid gap-3 sm:grid-cols-3">
            {MEETING_ROLES.map((role) => (
              <Field key={role} label={MEETING_ROLE_LABELS[role]} hint={ledger.data?.suggested[role] ? `Suggested: ${ledger.data.suggested[role]!.displayName}` : undefined}>
                {(id, d) => (
                  <Select id={id} aria-describedby={d} value={draft[role]} onChange={(e) => setDraft({ ...draft, [role]: e.target.value })}>
                    <option value="">Nobody</option>
                    {(members.data ?? []).map((mem) => (
                      <option key={mem.id} value={mem.id}>
                        {mem.displayName}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={save.isPending}>
              Save roles
            </Button>
            <Button size="sm" variant="secondary" onClick={useSuggested} disabled={!ledger.data}>
              Use suggested
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <Dialog open={ledgerOpen} onClose={() => setLedgerOpen(false)} title="Fairness ledger" wide>
        <p className="mb-3 text-sm text-ink-muted">How often each member has taken a role. The suggested next person has had the fewest turns, then the longest gap.</p>
        {ledger.isPending && <Spinner />}
        {ledger.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th scope="col" className="label border-b border-line pb-2 text-ink-muted">
                    Member
                  </th>
                  {MEETING_ROLES.map((role) => (
                    <th key={role} scope="col" className="label border-b border-line pb-2 text-ink-muted">
                      {MEETING_ROLE_LABELS[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.data.members.map((entry) => (
                  <tr key={entry.id} className="border-b border-line/60">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      <span className="flex items-center gap-2">
                        <Avatar member={entry} size="xs" /> {entry.displayName}
                      </span>
                    </th>
                    {MEETING_ROLES.map((role) => {
                      const suggested = ledger.data!.suggested[role]?.id === entry.id;
                      return (
                        <td key={role} className={cx("py-2 pr-3 tabular-nums", suggested && "font-semibold")}>
                          {entry.counts[role] ?? 0}
                          {entry.lastAssignedAt[role] && <span className="ml-1 text-xs text-ink-muted">last {formatDate(entry.lastAssignedAt[role])}</span>}
                          {suggested && (
                            <Badge tone="brass" className="ml-1.5">
                              Next
                            </Badge>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {ledger.data.members.length === 0 && <p className="py-4 text-sm text-ink-muted">No roles assigned yet.</p>}
          </div>
        )}
      </Dialog>
    </Card>
  );
}
