import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, Share2 } from "lucide-react";
import { useState } from "react";
import type { ClubInvite } from "@shared/types";
import { api, errorMessage } from "@/lib/api";
import { Alert, Button, Field, Input, Select } from "./ui";

const EXPIRY = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "", label: "Never" },
];

/** Copy a join link, or hand it to the system share sheet where one exists. */
export function InviteLink({ invite, clubName }: { invite: ClubInvite; clubName: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input readOnly value={invite.url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="secondary"
          icon={copied ? Check : Copy}
          onClick={async () => {
            try {
              await navigator.clipboard?.writeText(invite.url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              /* clipboard blocked: the field is selectable */
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        {canShare && (
          <Button
            variant="secondary"
            icon={Share2}
            aria-label="Share link"
            title="Share link"
            onClick={() => navigator.share({ title: `Join ${clubName} on Chapterr`, text: `Join ${clubName} on Chapterr`, url: invite.url }).catch(() => undefined)}
          />
        )}
      </div>
      <p className="text-xs text-ink-muted">
        Code <span className="font-semibold tracking-wider text-ink">{invite.code}</span>
        {invite.expiresAt ? ` · expires ${new Date(invite.expiresAt).toLocaleDateString()}` : " · never expires"}
        {invite.maxUses ? ` · ${invite.maxUses} uses` : ""}
      </p>
    </div>
  );
}

/** Create a join link for a club (admins and owners). */
export function InviteCreator({ clubId, clubName, onCreated, compact = false }: { clubId: string; clubName: string; onCreated?: (invite: ClubInvite) => void; compact?: boolean }) {
  const qc = useQueryClient();
  const [expires, setExpires] = useState("7");
  const [maxUses, setMaxUses] = useState("");
  const [created, setCreated] = useState<ClubInvite | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<ClubInvite>(`/api/clubs/${clubId}/invites`, { body: { expiresInDays: expires ? Number(expires) : null, maxUses: maxUses ? Number(maxUses) : null } }),
    onSuccess: (invite) => {
      setCreated(invite);
      void qc.invalidateQueries({ queryKey: ["club-invites", clubId] });
      onCreated?.(invite);
    },
  });
  if (created) {
    return (
      <div className="space-y-3">
        <InviteLink invite={created} clubName={clubName} />
        <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
          Create another
        </Button>
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className={compact ? "grid gap-3 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2"}>
        <Field label="Link expires in">
          {(id) => (
            <Select id={id} value={expires} onChange={(e) => setExpires(e.target.value)}>
              {EXPIRY.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Maximum uses" hint="Leave blank for no limit.">
          {(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" min={1} max={500} type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />}
        </Field>
      </div>
      {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}
      <Button type="submit" icon={Link2} loading={create.isPending}>
        Create link
      </Button>
    </form>
  );
}
