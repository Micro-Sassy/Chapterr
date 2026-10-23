import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CreditCard, Crown, LogOut, Trash2, UserMinus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router";
import type { z } from "zod";
import { CLUB_PLAN_LABELS, CLUB_ROLE_LABELS, LIMITS } from "@shared/constants";
import { clubCreateSchema, deleteClubSchema, transferOwnershipSchema } from "@shared/schemas";
import type { Club, ClubBilling, ClubInvite, ClubMember } from "@shared/types";
import { RoleChip } from "@/components/AppShell";
import { Avatar } from "@/components/Avatar";
import { InviteCreator, InviteLink } from "@/components/InviteCreator";
import { clubApi } from "@/components/records";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, SectionTitle, Select, Spinner, Tabs, Textarea } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { isAdmin, useClub } from "@/lib/club";
import { useConfig } from "@/lib/config";
import { formatDate, formatDateTime } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

type TabKey = "details" | "invites" | "members" | "billing" | "danger";

// --- Details --------------------------------------------------------------------------------------

type DetailsValues = z.input<typeof clubCreateSchema>;

function DetailsTab({ club }: { club: Club }) {
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = isAdmin(club);
  const [conflict, setConflict] = useState<Club | null>(null);
  const form = useForm<DetailsValues>({ resolver: zodResolver(clubCreateSchema), defaultValues: { name: club.name, description: club.description ?? "" } });
  const save = useMutation({
    mutationFn: (v: DetailsValues) => api<Club>(clubApi(club.id, ""), { method: "PUT", body: { ...v, expectedVersion: club.version } }),
    onSuccess: (updated) => {
      qc.setQueryData(["club", club.id], updated);
      void qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["home"] });
      form.reset({ name: updated.name, description: updated.description ?? "" });
      toast("Club details saved.");
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.status === 409 && err.current) {
        const current = err.current as Club;
        setConflict(current);
        qc.setQueryData(["club", club.id], current);
        return;
      }
      if (err instanceof ApiRequestError && err.fields) {
        for (const [k, v] of Object.entries(err.fields)) if (k === "name" || k === "description") form.setError(k, { message: v[0] });
      }
    },
  });
  const e = form.formState.errors;
  return (
    <Card>
      <SectionTitle as="h2">Club details</SectionTitle>
      {!canEdit && <p className="mb-4 text-sm text-ink-muted">Only admins can change these details.</p>}
      {conflict && (
        <Alert tone="warning" title="Someone else changed these details first" className="mb-4">
          The latest version is now loaded.{" "}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => {
              form.reset({ name: conflict.name, description: conflict.description ?? "" });
              setConflict(null);
            }}
          >
            Use the latest version
          </button>{" "}
          or save again to overwrite it.
        </Alert>
      )}
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <Field label="Club name" error={e.name?.message}>
          {(id) => <Input id={id} maxLength={LIMITS.clubNameMax} disabled={!canEdit} invalid={!!e.name} {...form.register("name")} />}
        </Field>
        <Field label="Description" error={e.description?.message}>
          {(id) => <Textarea id={id} rows={3} maxLength={LIMITS.clubDescriptionMax} disabled={!canEdit} {...form.register("description")} />}
        </Field>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-muted">Owner</dt>
            <dd>{club.owner?.displayName ?? "Former member"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Members</dt>
            <dd>
              {club.memberCount} of {club.memberLimit}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Created</dt>
            <dd>{formatDate(club.createdAt)}</dd>
          </div>
        </dl>
        {save.isError && !conflict && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        {canEdit && (
          <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
            Save details
          </Button>
        )}
      </form>
    </Card>
  );
}

// --- Invites --------------------------------------------------------------------------------------

function InvitesTab({ club }: { club: Club }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["club-invites", club.id], queryFn: () => api<ClubInvite[]>(clubApi(club.id, "/invites")) });
  const revoke = useMutation({
    mutationFn: (id: string) => api(clubApi(club.id, `/invites/${id}`), { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["club-invites", club.id] });
      toast("Invite revoked.");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const status = (i: ClubInvite) => {
    if (i.revokedAt) return "revoked";
    if (i.expiresAt && new Date(i.expiresAt).getTime() < Date.now()) return "expired";
    if (i.maxUses && i.useCount >= i.maxUses) return "used up";
    return "active";
  };
  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle as="h2">New invite link</SectionTitle>
        <p className="mb-4 text-sm text-ink-muted">Anyone with the link can join as a member. Up to 20 live invites per club.</p>
        <InviteCreator clubId={club.id} clubName={club.name} />
      </Card>
      <Card>
        <SectionTitle as="h2">Invite links</SectionTitle>
        {q.isPending && <Spinner />}
        {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
        {q.data?.length === 0 && <EmptyState title="No invites yet">Create a link above to bring people in.</EmptyState>}
        <ul className="divide-y divide-line">
          {q.data?.map((i) => {
            const s = status(i);
            return (
              <li key={i.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={s === "active" ? "success" : "neutral"}>{s === "active" ? "Active" : s === "revoked" ? "Revoked" : s === "expired" ? "Expired" : "Used up"}</Badge>
                  <span className="text-sm text-ink-muted">
                    Created {formatDate(i.createdAt)} by {i.createdBy?.displayName ?? "a former member"} · used {i.useCount}
                    {i.maxUses ? ` of ${i.maxUses}` : ""} times
                    {i.expiresAt ? ` · expires ${formatDateTime(i.expiresAt)}` : ""}
                  </span>
                  {s === "active" && (
                    <Button size="sm" variant="secondary" icon={Ban} className="ml-auto" loading={revoke.isPending && revoke.variables === i.id} onClick={() => revoke.mutate(i.id)}>
                      Revoke
                    </Button>
                  )}
                </div>
                {s === "active" && <InviteLink invite={i} clubName={club.name} />}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

// --- Members & roles --------------------------------------------------------------------------------

function MembersTab({ club }: { club: Club }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: session } = useSession();
  const q = useQuery({ queryKey: ["club-members", club.id], queryFn: () => api<ClubMember[]>(clubApi(club.id, "/members")) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["club-members", club.id] });
    void qc.invalidateQueries({ queryKey: ["club", club.id] });
    void qc.invalidateQueries({ queryKey: ["me"] });
  };
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "admin" | "member" }) => api<ClubMember>(clubApi(club.id, `/members/${userId}/role`), { method: "PUT", body: { role } }),
    onSuccess: (m) => {
      refresh();
      toast(`${m.displayName} is now ${CLUB_ROLE_LABELS[m.role].toLowerCase()}.`);
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const remove = useMutation({
    mutationFn: (m: ClubMember) => api(clubApi(club.id, `/members/${m.id}`), { method: "DELETE" }),
    onSuccess: (_d, m) => {
      refresh();
      toast(`${m.displayName} was removed from the club.`);
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const viewerOwner = club.role === "owner";
  const canManage = (m: ClubMember) => {
    if (m.id === session?.user.id || m.role === "owner") return { role: false, remove: false };
    if (viewerOwner) return { role: true, remove: true };
    // Admins may promote members and remove members, but never touch other admins.
    return { role: m.role === "member", remove: m.role === "member" };
  };
  return (
    <Card>
      <SectionTitle as="h2">Members and roles</SectionTitle>
      <p className="mb-4 text-sm text-ink-muted">
        Admins manage invites, members and details. The owner can also hand over the club or delete it.
        {!viewerOwner && " Only the owner can change another admin."}
      </p>
      {q.isPending && <Spinner />}
      <ul className="divide-y divide-line">
        {q.data?.map((m) => {
          const can = canManage(m);
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <Avatar member={m} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.displayName} {m.id === session?.user.id && <span className="text-ink-muted">(you)</span>}
                </p>
                <p className="truncate text-xs text-ink-muted">
                  @{m.username} · joined {formatDate(m.joinedAt)}
                </p>
              </div>
              {can.role ? (
                <Select
                  aria-label={`Role for ${m.displayName}`}
                  className="h-9 w-32 text-sm"
                  value={m.role}
                  disabled={setRole.isPending}
                  onChange={(e) => setRole.mutate({ userId: m.id, role: e.target.value as "admin" | "member" })}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </Select>
              ) : (
                <RoleChip role={m.role} />
              )}
              {can.remove && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={UserMinus}
                  aria-label={`Remove ${m.displayName}`}
                  loading={remove.isPending && remove.variables?.id === m.id}
                  onClick={() => confirm(`Remove ${m.displayName} from ${club.name}?`) && remove.mutate(m)}
                >
                  Remove
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// --- Billing --------------------------------------------------------------------------------------

function BillingTab({ club }: { club: Club }) {
  const { data: config } = useConfig();
  const q = useQuery({ queryKey: ["club-billing", club.id], queryFn: () => api<ClubBilling>(clubApi(club.id, "/billing")) });
  const price = ((q.data?.priceCents ?? config?.clubPriceCents ?? 100) / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
  const enabled = q.data?.billingEnabled ?? config?.billingEnabled ?? false;
  return (
    <Card>
      <SectionTitle as="h2">Billing</SectionTitle>
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-control border border-line bg-ground p-4">
            <CreditCard className="size-5 text-ink-muted" aria-hidden strokeWidth={1.75} />
            <div>
              <p className="label text-ink-muted">Plan</p>
              <p className="heading-s">{CLUB_PLAN_LABELS[q.data.plan] ?? q.data.plan}</p>
            </div>
            <Badge tone="success" className="ml-auto">
              {enabled ? q.data.billingStatus : "Nothing due"}
            </Badge>
          </div>
          <p className="text-sm">{q.data.message || `${price} per club per month after beta. Nothing to set up now.`}</p>
          <p className="text-sm text-ink-muted">
            Every club is free while Chapterr is in beta. When billing starts, the owner will get at least 30 days' notice and nothing changes until they choose a plan.
          </p>
        </div>
      )}
    </Card>
  );
}

// --- Leave & danger zone ------------------------------------------------------------------------------

function LeaveCard({ club }: { club: Club }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const leave = useMutation({
    mutationFn: () => api(clubApi(club.id, "/leave"), { method: "POST", body: {} }),
    onSuccess: async () => {
      qc.removeQueries({ queryKey: ["club", club.id] });
      await qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["home"] });
      toast(`You left ${club.name}.`);
      navigate("/", { replace: true });
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const owner = club.role === "owner";
  return (
    <Card>
      <SectionTitle as="h2">Leave this club</SectionTitle>
      <p className="mb-4 text-sm text-ink-muted">
        {owner
          ? "Owners can't leave. Transfer ownership to another member first, then leave."
          : "You'll lose access to the club's shelf, schedule and messages. Your own library, reviews and quotes stay with you."}
      </p>
      <Button variant="secondary" icon={LogOut} disabled={owner} loading={leave.isPending} onClick={() => confirm(`Leave ${club.name}?`) && leave.mutate()}>
        Leave club
      </Button>
    </Card>
  );
}

type TransferValues = z.input<typeof transferOwnershipSchema>;
type DeleteValues = z.input<typeof deleteClubSchema>;

function OwnerZone({ club }: { club: Club }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: session } = useSession();
  const [transferring, setTransferring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const members = useQuery({ queryKey: ["club-members", club.id], queryFn: () => api<ClubMember[]>(clubApi(club.id, "/members")) });
  const transferForm = useForm<TransferValues>({ resolver: zodResolver(transferOwnershipSchema), defaultValues: { userId: "", currentPassword: "" } });
  const transfer = useMutation({
    mutationFn: (v: TransferValues) => api<Club>(clubApi(club.id, "/transfer-ownership"), { method: "POST", body: v }),
    onSuccess: (updated) => {
      qc.setQueryData(["club", club.id], updated);
      void qc.invalidateQueries({ queryKey: ["club", club.id] });
      void qc.invalidateQueries({ queryKey: ["club-members", club.id] });
      void qc.invalidateQueries({ queryKey: ["me"] });
      setTransferring(false);
      toast(`${updated.owner?.displayName ?? "The new owner"} now owns ${club.name}.`);
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.status === 401) transferForm.setError("currentPassword", { message: "That password is not right." });
    },
  });
  const deleteForm = useForm<DeleteValues>({ resolver: zodResolver(deleteClubSchema), defaultValues: { confirmName: "", currentPassword: "" } });
  const del = useMutation({
    mutationFn: (v: DeleteValues) => api(clubApi(club.id, "/delete"), { method: "POST", body: v }),
    onSuccess: async () => {
      qc.removeQueries({ queryKey: ["club", club.id] });
      await qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["home"] });
      toast(`${club.name} was deleted.`);
      navigate("/", { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.status === 401) deleteForm.setError("currentPassword", { message: "That password is not right." });
    },
  });
  const candidates = (members.data ?? []).filter((m) => m.id !== session?.user.id);
  return (
    <Card className="border-error/40">
      <SectionTitle as="h2">Owner only</SectionTitle>
      <div className="divide-y divide-line">
        <div className="flex flex-wrap items-center gap-3 py-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Transfer ownership</p>
            <p className="text-sm text-ink-muted">Hand the club to another member. You'll stay on as an admin.</p>
          </div>
          <Button variant="secondary" icon={Crown} onClick={() => setTransferring(true)} disabled={candidates.length === 0}>
            Transfer
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 py-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Delete this club</p>
            <p className="text-sm text-ink-muted">The club disappears for everyone right away and its data is purged after 30 days. Members keep their own libraries.</p>
          </div>
          <Button variant="danger" icon={Trash2} onClick={() => setDeleting(true)}>
            Delete club
          </Button>
        </div>
      </div>

      <Dialog open={transferring} onClose={() => setTransferring(false)} title="Transfer ownership">
        <form onSubmit={transferForm.handleSubmit((v) => transfer.mutate(v))} className="space-y-4" noValidate>
          <Field label="New owner" error={transferForm.formState.errors.userId?.message}>
            {(id) => (
              <Select id={id} {...transferForm.register("userId")}>
                <option value="">Choose a member</option>
                {candidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} (@{m.username}) · {CLUB_ROLE_LABELS[m.role]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Your password" error={transferForm.formState.errors.currentPassword?.message}>
            {(id) => <Input id={id} type="password" autoComplete="current-password" {...transferForm.register("currentPassword")} />}
          </Field>
          {transfer.isError && !transferForm.formState.errors.currentPassword && <Alert tone="error">{errorMessage(transfer.error)}</Alert>}
          <Button type="submit" loading={transfer.isPending}>
            Transfer ownership
          </Button>
        </form>
      </Dialog>

      <Dialog open={deleting} onClose={() => setDeleting(false)} title={`Delete ${club.name}`}>
        <form onSubmit={deleteForm.handleSubmit((v) => del.mutate(v))} className="space-y-4" noValidate>
          <Alert tone="warning">This removes the club for all {club.memberCount} members. It cannot be undone after 30 days.</Alert>
          <Field label={`Type the club name to confirm: ${club.name}`} error={deleteForm.formState.errors.confirmName?.message}>
            {(id) => <Input id={id} autoComplete="off" {...deleteForm.register("confirmName")} />}
          </Field>
          <Field label="Your password" error={deleteForm.formState.errors.currentPassword?.message}>
            {(id) => <Input id={id} type="password" autoComplete="current-password" {...deleteForm.register("currentPassword")} />}
          </Field>
          {del.isError && !deleteForm.formState.errors.currentPassword && <Alert tone="error">{errorMessage(del.error)}</Alert>}
          <Button type="submit" variant="danger" icon={Trash2} loading={del.isPending} disabled={deleteForm.watch("confirmName") !== club.name}>
            Delete club
          </Button>
        </form>
      </Dialog>
    </Card>
  );
}

export function ClubSettingsPage() {
  const club = useClub();
  useDocumentTitle(`Settings · ${club.name}`);
  const [params, setParams] = useSearchParams();
  const admin = isAdmin(club);
  const requested = (params.get("tab") as TabKey | null) ?? "details";
  const tab: TabKey = !admin && (requested === "invites" || requested === "members") ? "details" : requested;
  const tabs: { value: TabKey; label: string }[] = [
    { value: "details", label: "Details" },
    ...(admin ? [{ value: "invites" as const, label: "Invites" }, { value: "members" as const, label: "Members" }] : []),
    { value: "billing", label: "Billing" },
    { value: "danger", label: club.role === "owner" ? "Leave or delete" : "Leave" },
  ];
  return (
    <div>
      <PageHeader eyebrow={club.name} title="Club settings" />
      <Tabs label="Club settings sections" value={tab} onChange={(t) => setParams({ tab: t })} tabs={tabs} />
      {tab === "details" && <DetailsTab club={club} />}
      {tab === "invites" && admin && <InvitesTab club={club} />}
      {tab === "members" && admin && <MembersTab club={club} />}
      {tab === "billing" && <BillingTab club={club} />}
      {tab === "danger" && (
        <div className="space-y-6">
          <LeaveCard club={club} />
          {club.role === "owner" && <OwnerZone club={club} />}
        </div>
      )}
    </div>
  );
}

