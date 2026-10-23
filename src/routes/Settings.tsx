import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, LogOut, Monitor, Trash2, Upload, UserX } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router";
import type { z } from "zod";
import { LIMITS } from "@shared/constants";
import { parseGoodreadsCsv, type GoodreadsParseResult } from "@shared/goodreads";
import { changeEmailSchema, changePasswordSchema, changeUsernameSchema, profileUpdateSchema } from "@shared/schemas";
import type { ImportRecord, ImportResult, Me, PushPreferences, SessionInfo, ShareLink } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { PhoneForm, type MeWithContact } from "@/components/growth/PhoneForm";
import { PushSettings, type MergedPreferences } from "@/components/growth/PushSettings";
import { Alert, Badge, Button, buttonClass, Card, Checkbox, EmptyState, Field, Input, PageHeader, SectionTitle, Select, Spinner, Tabs, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { sessionKey, useSignOut } from "@/lib/auth";
import { formatDate, formatDateTime, relativeTime } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

type TabKey = "profile" | "account" | "notifications" | "sessions" | "sharing" | "import" | "data";

function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/account/me") });
}

function applyFieldErrors(err: unknown, setError: (name: never, e: { message: string }) => void) {
  if (err instanceof ApiRequestError && err.fields) {
    for (const [k, v] of Object.entries(err.fields)) if (k !== "_form") setError(k as never, { message: v[0] ?? "Invalid" });
  }
}

// --- Profile ---------------------------------------------------------------------------------

/** Resize an image in the browser to a 256px square WebP/JPEG so avatars stay tiny in D1. */
export async function resizeImage(file: File): Promise<{ contentType: "image/webp" | "image/jpeg"; data: string }> {
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  let dataUrl = canvas.toDataURL("image/webp", 0.85);
  let contentType: "image/webp" | "image/jpeg" = "image/webp";
  if (!dataUrl.startsWith("data:image/webp")) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    contentType = "image/jpeg";
  }
  return { contentType, data: dataUrl.split(",")[1]! };
}

function ProfileTab({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm<z.input<typeof profileUpdateSchema>>({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: {
      displayName: me.displayName,
      bio: me.profile.bio ?? "",
      location: me.profile.location ?? "",
      pronouns: me.profile.pronouns ?? "",
      favoriteGenres: me.profile.favoriteGenres ?? "",
      defaultVisibility: me.profile.defaultVisibility,
    },
  });
  const save = useMutation({
    mutationFn: (v: z.input<typeof profileUpdateSchema>) => api<Me>("/api/account/profile", { method: "PUT", body: v }),
    onSuccess: (data) => {
      qc.setQueryData(["me"], data);
      void qc.invalidateQueries({ queryKey: sessionKey });
      toast("Profile saved.");
    },
    onError: (err) => applyFieldErrors(err, form.setError as never),
  });
  const avatar = useMutation({
    mutationFn: async (file: File | null) =>
      file ? api<Me>("/api/account/avatar", { method: "PUT", body: await resizeImage(file) }) : api<Me>("/api/account/avatar", { method: "DELETE" }),
    onSuccess: (data) => {
      qc.setQueryData(["me"], data);
      void qc.invalidateQueries({ queryKey: sessionKey });
      toast("Photo updated.");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const e = form.formState.errors;
  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center gap-4">
        <Avatar member={me} size="lg" />
        <div className="space-y-2">
          <p className="text-sm font-medium">Profile photo</p>
          <div className="flex flex-wrap gap-2">
            <label className={buttonClass("secondary", "sm", "cursor-pointer")}>
              <Upload className="size-4" aria-hidden /> {avatar.isPending ? "Uploading…" : "Upload"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(ev) => {
                  const file = ev.target.files?.[0];
                  if (file) avatar.mutate(file);
                  ev.target.value = "";
                }}
              />
            </label>
            {me.avatarUrl && (
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => avatar.mutate(null)}>
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-ink-muted">Visible to members of your clubs only.</p>
        </div>
      </Card>
      <Card>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
          <Field label="Display name" error={e.displayName?.message}>
            {(id) => <Input id={id} {...form.register("displayName")} />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pronouns" error={e.pronouns?.message}>
              {(id) => <Input id={id} {...form.register("pronouns")} />}
            </Field>
            <Field label="Location" error={e.location?.message}>
              {(id) => <Input id={id} {...form.register("location")} />}
            </Field>
          </div>
          <Field label="Favourite genres" error={e.favoriteGenres?.message}>
            {(id) => <Input id={id} {...form.register("favoriteGenres")} />}
          </Field>
          <Field label="About me" error={e.bio?.message}>
            {(id) => <Textarea id={id} rows={4} maxLength={LIMITS.bioMax} {...form.register("bio")} />}
          </Field>
          <Field label="Default visibility for new shelf entries" hint="You can change it per book.">
            {(id, d) => (
              <Select id={id} aria-describedby={d} {...form.register("defaultVisibility")}>
                <option value="club">Members of my clubs</option>
                <option value="private">Only me</option>
              </Select>
            )}
          </Field>
          {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
          <Button type="submit" loading={save.isPending}>
            Save profile
          </Button>
        </form>
      </Card>
    </div>
  );
}

// --- Account & security --------------------------------------------------------------------------

function UsernameForm({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm<z.input<typeof changeUsernameSchema>>({ resolver: zodResolver(changeUsernameSchema), defaultValues: { username: me.username, currentPassword: "" } });
  const save = useMutation({
    mutationFn: (v: z.input<typeof changeUsernameSchema>) => api<Me>("/api/account/username", { method: "PUT", body: v }),
    onSuccess: (data) => {
      qc.setQueryData(["me"], data);
      void qc.invalidateQueries({ queryKey: sessionKey });
      form.reset({ username: data.username, currentPassword: "" });
      toast("Username changed.");
    },
    onError: (err) => applyFieldErrors(err, form.setError as never),
  });
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
      <SectionTitle>Username</SectionTitle>
      <Field label="New username" error={form.formState.errors.username?.message}>
        {(id) => <Input id={id} autoCapitalize="none" {...form.register("username")} />}
      </Field>
      <Field label="Current password" error={form.formState.errors.currentPassword?.message}>
        {(id) => <Input id={id} type="password" autoComplete="current-password" {...form.register("currentPassword")} />}
      </Field>
      {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      <Button type="submit" loading={save.isPending}>
        Change username
      </Button>
    </form>
  );
}

function EmailForm({ me }: { me: Me }) {
  const [sent, setSent] = useState<string | null>(null);
  const form = useForm<z.input<typeof changeEmailSchema>>({ resolver: zodResolver(changeEmailSchema), defaultValues: { newEmail: "", currentPassword: "" } });
  const save = useMutation({
    mutationFn: (v: z.input<typeof changeEmailSchema>) => api<{ message: string }>("/api/account/email", { body: v }),
    onSuccess: (r) => {
      setSent(r.message);
      form.reset();
    },
    onError: (err) => applyFieldErrors(err, form.setError as never),
  });
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
      <SectionTitle>Email address</SectionTitle>
      <p className="text-sm text-ink-muted">
        Current: <strong>{me.email}</strong>. We will send a confirmation link to the new address; the change takes effect once you open it.
      </p>
      <Field label="New email" error={form.formState.errors.newEmail?.message}>
        {(id) => <Input id={id} type="email" autoComplete="email" {...form.register("newEmail")} />}
      </Field>
      <Field label="Current password" error={form.formState.errors.currentPassword?.message}>
        {(id) => <Input id={id} type="password" autoComplete="current-password" {...form.register("currentPassword")} />}
      </Field>
      {sent && <Alert tone="success">{sent}</Alert>}
      {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      <Button type="submit" loading={save.isPending}>
        Change email
      </Button>
    </form>
  );
}

function PasswordForm() {
  const toast = useToast();
  const form = useForm<z.input<typeof changePasswordSchema>>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "", revokeOtherSessions: true },
  });
  const save = useMutation({
    mutationFn: (v: z.input<typeof changePasswordSchema>) => api("/api/account/password", { body: v }),
    onSuccess: () => {
      form.reset();
      toast("Password changed.");
    },
    onError: (err) => applyFieldErrors(err, form.setError as never),
  });
  const e = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
      <SectionTitle>Password</SectionTitle>
      <Field label="Current password" error={e.currentPassword?.message}>
        {(id) => <Input id={id} type="password" autoComplete="current-password" {...form.register("currentPassword")} />}
      </Field>
      <Field label="New password" error={e.newPassword?.message}>
        {(id) => <Input id={id} type="password" autoComplete="new-password" {...form.register("newPassword")} />}
      </Field>
      <Field label="Confirm new password" error={e.confirmPassword?.message}>
        {(id) => <Input id={id} type="password" autoComplete="new-password" {...form.register("confirmPassword")} />}
      </Field>
      <Checkbox label="Sign out my other devices" {...form.register("revokeOtherSessions")} />
      {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      <Button type="submit" loading={save.isPending}>
        Change password
      </Button>
    </form>
  );
}

function AccountTab({ me }: { me: Me }) {
  const [params] = useSearchParams();
  return (
    <div className="space-y-6">
      {params.get("emailChanged") && <Alert tone="success">Your email address was confirmed and updated.</Alert>}
      <Card>
        <UsernameForm me={me} />
      </Card>
      <Card>
        <EmailForm me={me} />
      </Card>
      <Card>
        <PasswordForm />
      </Card>
    </div>
  );
}

// --- Notifications -------------------------------------------------------------------------------------

function NotificationsTab({ me }: { me: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [prefs, setPrefs] = useState<MergedPreferences>(me.preferences as MergedPreferences);
  const save = useMutation({
    mutationFn: () => api<Me>("/api/account/preferences", { method: "PUT", body: prefs }),
    onSuccess: (data) => {
      qc.setQueryData(["me"], data);
      toast("Preferences saved.");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const toggle = (key: keyof MergedPreferences, label: string, fallback = false) => (
    <Checkbox label={label} checked={prefs[key] ?? fallback} onChange={(e) => setPrefs({ ...prefs, [key]: e.target.checked })} />
  );
  const patchPush = (next: Partial<PushPreferences>) => setPrefs((p) => ({ ...p, ...next }));
  return (
    <div className="space-y-6">
      <Card className="space-y-5">
        <div className="space-y-2">
          <SectionTitle>In the app</SectionTitle>
          {toggle("inappDirectMessages", "New direct messages")}
          {toggle("inappRecommendations", "Books recommended to me or the club")}
          {toggle("inappClubUpdates", "Club updates: meetings, assignments, members joining")}
          {toggle("inappReactions", "Reactions to my reviews")}
        </div>
        <div className="space-y-2">
          <SectionTitle>By email</SectionTitle>
          {toggle("emailClubUpdates", "Email me about club meetings and assignments")}
          {toggle("emailRecommendations", "Email me when someone recommends a book to me")}
          {toggle("emailMeetingReminders", "Email me meeting reminders at the times my club sets", true)}
          {toggle("digestCatchUp", "Send a catch-up digest when a club chat gets busy while I am away", true)}
          <p className="text-xs text-ink-muted">Security emails (verification, password resets) are always sent.</p>
        </div>
        <div className="space-y-3">
          <SectionTitle>Push</SectionTitle>
          <PushSettings prefs={prefs} onChange={patchPush} />
        </div>
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Save preferences
        </Button>
      </Card>
      <Card>
        <PhoneForm me={me as MeWithContact} />
      </Card>
    </div>
  );
}

// --- Sessions --------------------------------------------------------------------------------------------

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` on ${os}` : ""}`;
}

function SessionsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const q = useQuery({ queryKey: ["sessions"], queryFn: () => api<SessionInfo[]>("/api/account/sessions") });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/account/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      toast("Session signed out.");
    },
  });
  const revokeOthers = useMutation({
    mutationFn: () => api<{ revoked: number }>("/api/account/sessions/revoke-others", { body: {} }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["sessions"] });
      toast(`Signed out ${r.revoked} other session${r.revoked === 1 ? "" : "s"}`);
    },
  });
  return (
    <Card className="space-y-4">
      <SectionTitle
        action={
          <Button size="sm" variant="secondary" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>
            Sign out other devices
          </Button>
        }
      >
        Where you're signed in
      </SectionTitle>
      {q.isPending && <Spinner />}
      <ul className="divide-y divide-line">
        {q.data?.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-3">
            <Monitor className="size-5 text-ink-muted" aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">
                {describeAgent(s.userAgent)} {s.current && <Badge tone="forest">This device</Badge>}
              </p>
              <p className="text-xs text-ink-muted">
                Signed in {relativeTime(s.createdAt)}
                {s.ipAddress ? ` · ${s.ipAddress}` : ""} · expires {formatDate(s.expiresAt)}
              </p>
            </div>
            {s.current ? (
              <Button
                size="sm"
                variant="ghost"
                icon={LogOut}
                onClick={async () => {
                  await signOut();
                  navigate("/sign-in");
                }}
              >
                Sign out
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// --- Share links -------------------------------------------------------------------------------------------

function SharingTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["shares"], queryFn: () => api<ShareLink[]>("/api/shares") });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/shares/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shares"] });
      toast("Link turned off.");
    },
  });
  const now = new Date().toISOString();
  return (
    <Card className="space-y-4">
      <SectionTitle>Public share links</SectionTitle>
      <p className="text-sm text-ink-muted">
        Links you created to share a review, quote or list with anyone. Turning a link off takes effect immediately. Messages can never be shared.
      </p>
      {q.isPending && <Spinner />}
      {q.data?.length === 0 && <EmptyState title="No share links">Use the share button on a review, quote or list to create one.</EmptyState>}
      <ul className="divide-y divide-line">
        {q.data?.map((s) => {
          const active = !s.revokedAt && (!s.expiresAt || s.expiresAt > now);
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">{s.label}</p>
                <p className="text-xs text-ink-muted">
                  Created {formatDate(s.createdAt)} · {s.viewCount} view{s.viewCount === 1 ? "" : "s"}
                  {s.expiresAt ? ` · expires ${formatDateTime(s.expiresAt)}` : ""}
                </p>
              </div>
              {active ? (
                <Button size="sm" variant="secondary" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>
                  Turn off
                </Button>
              ) : (
                <Badge>{s.revokedAt ? "Turned off" : "Expired"}</Badge>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// --- Goodreads import -------------------------------------------------------------------------------------------

function ImportTab() {
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<GoodreadsParseResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<"club" | "private">("club");
  const [importReviews, setImportReviews] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const history = useQuery({ queryKey: ["imports"], queryFn: () => api<ImportRecord[]>("/api/imports") });

  const onFile = async (file: File | undefined) => {
    setParsed(null);
    setResult(null);
    setFileError(null);
    if (!file) return;
    if (file.size > LIMITS.importFileBytesMax) return setFileError("That file is larger than 10 MB.");
    const text = await file.text();
    const res = parseGoodreadsCsv(text);
    if (res.rows.length === 0) setFileError(res.errors[0]?.message ?? "No books found in that file.");
    setParsed(res);
  };

  const run = async () => {
    if (!parsed) return;
    setRunError(null);
    const rows = parsed.rows;
    const size = LIMITS.importRowsPerBatch;
    const total: ImportResult = { importId: "", created: 0, updated: 0, skipped: 0, errors: [] };
    setProgress({ done: 0, total: rows.length });
    try {
      for (let i = 0; i < rows.length; i += size) {
        const batch = rows.slice(i, i + size);
        const res = await api<ImportResult>("/api/imports/goodreads/batch", {
          body: {
            importId: total.importId || null,
            visibility,
            importReviews,
            rows: batch,
            totalRows: rows.length,
            isFinalBatch: i + size >= rows.length,
          },
        });
        total.importId = res.importId;
        total.created += res.created;
        total.updated += res.updated;
        total.skipped += res.skipped;
        total.errors.push(...res.errors.map((e) => ({ ...e, row: e.row + i })));
        setProgress({ done: Math.min(rows.length, i + size), total: rows.length });
      }
      setResult(total);
      void qc.invalidateQueries();
    } catch (err) {
      setRunError(`${errorMessage(err)} You can safely run the import again. Books already imported are updated, not duplicated.`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <SectionTitle>Import from Goodreads</SectionTitle>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted">
          <li>
            On Goodreads, open <strong>My Books → Import and export</strong> and choose <strong>Export Library</strong>.
          </li>
          <li>Download the CSV file when it is ready.</li>
          <li>Choose that file below. Nothing is uploaded until you confirm.</li>
        </ol>
        <label className={buttonClass("secondary", "md", "cursor-pointer")}>
          <FileUp className="size-4" aria-hidden /> Choose CSV file
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {fileError && <Alert tone="error">{fileError}</Alert>}
        {parsed && parsed.rows.length > 0 && !result && (
          <div className="space-y-4">
            <Alert tone="info" title={`Found ${parsed.rows.length} books`}>
              {parsed.stats.finished} read · {parsed.stats.reading} currently reading · {parsed.stats.tbr} to-read
              {parsed.stats.abandoned ? ` · ${parsed.stats.abandoned} did not finish` : ""} · {parsed.stats.reviews} ratings/reviews
              {parsed.errors.length > 0 && <p className="mt-1">{parsed.errors.length} rows could not be read and will be skipped.</p>}
            </Alert>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Visibility of imported books">
                {(id) => (
                  <Select id={id} value={visibility} onChange={(e) => setVisibility(e.target.value as "club" | "private")}>
                    <option value="club">Members of my clubs</option>
                    <option value="private">Only me</option>
                  </Select>
                )}
              </Field>
              <div className="flex items-end pb-2">
                <Checkbox label="Import my ratings and reviews" checked={importReviews} onChange={(e) => setImportReviews(e.target.checked)} />
              </div>
            </div>
            <p className="text-xs text-ink-muted">
              Star ratings map to the five review feelings (5 stars loved it, 1 star really disliked it). Private notes stay private. Existing reviews in the app are
              never overwritten.
            </p>
            {progress ? (
              <div role="status" className="text-sm">
                Importing… {progress.done} of {progress.total}
              </div>
            ) : (
              <Button icon={Upload} onClick={() => void run()}>
                Import {parsed.rows.length} books
              </Button>
            )}
          </div>
        )}
        {runError && <Alert tone="error">{runError}</Alert>}
        {result && (
          <Alert tone="success" title="Import complete">
            {result.created} added · {result.updated} updated · {result.skipped} skipped
            {result.errors.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs">
                {result.errors.slice(0, 10).map((e) => (
                  <li key={e.row}>
                    {e.title}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}
      </Card>
      {history.data && history.data.length > 0 && (
        <Card>
          <SectionTitle>Previous imports</SectionTitle>
          <ul className="divide-y divide-line text-sm">
            {history.data.map((h) => (
              <li key={h.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{formatDateTime(h.createdAt)}</span>
                <span className="text-ink-muted">
                  {h.status === "completed" ? "Completed" : h.status === "running" ? "Incomplete" : "Failed"} · {h.created} added · {h.updated} updated ·{" "}
                  {h.skipped} skipped
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// --- Data --------------------------------------------------------------------------------------------------------

function DataTab() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const del = useMutation({
    mutationFn: () => api("/api/account/delete", { body: { password, confirm: confirmText } }),
    onSuccess: () => {
      qc.clear();
      navigate("/sign-in", { replace: true });
    },
  });
  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <SectionTitle>Download my data</SectionTitle>
        <p className="text-sm text-ink-muted">A JSON file with your profile, library, reviews, quotes, goals, recommendations and messages you sent.</p>
        <a href="/api/account/export" download className={buttonClass("secondary")}>
          <Download className="size-4" aria-hidden /> Download
        </a>
      </Card>
      <Card className="space-y-3 border-error/40">
        <SectionTitle>Delete my account</SectionTitle>
        <p className="text-sm text-ink-muted">
          Permanently deletes your account, library, reviews, quotes, goals, recommendations and messages. Shared club records you created (such as
          meetings) remain for their clubs without your name. Clubs you own must be transferred or deleted first. This cannot be undone.
        </p>
        <Field label="Current password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Field label='Type "DELETE" to confirm'>{(id) => <Input id={id} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />}</Field>
        {del.isError && <Alert tone="error">{errorMessage(del.error)}</Alert>}
        <Button variant="danger" icon={UserX} disabled={confirmText !== "DELETE" || !password} loading={del.isPending} onClick={() => del.mutate()}>
          Delete account
        </Button>
      </Card>
    </div>
  );
}

export function SettingsPage() {
  useDocumentTitle("Settings");
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabKey | null) ?? "profile";
  const me = useMe();
  return (
    <div>
      <PageHeader eyebrow="You" title="Account settings" />
      <Tabs
        label="Settings sections"
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { value: "profile", label: "Profile" },
          { value: "account", label: "Account" },
          { value: "notifications", label: "Notifications" },
          { value: "sessions", label: "Devices" },
          { value: "sharing", label: "Share links" },
          { value: "import", label: "Import" },
          { value: "data", label: "Your data" },
        ]}
      />
      {me.isPending && <Spinner />}
      {me.isError && <Alert tone="error">{errorMessage(me.error)}</Alert>}
      {me.data && (
        <>
          {tab === "profile" && <ProfileTab me={me.data} />}
          {tab === "account" && <AccountTab me={me.data} />}
          {tab === "notifications" && <NotificationsTab me={me.data} />}
          {tab === "sessions" && <SessionsTab />}
          {tab === "sharing" && <SharingTab />}
          {tab === "import" && <ImportTab />}
          {tab === "data" && <DataTab />}
        </>
      )}
    </div>
  );
}
