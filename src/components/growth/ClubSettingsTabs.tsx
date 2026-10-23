import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Link2, Palette, Send, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { WAVE2_LIMITS } from "@shared/constants";
import type { Club, ClubBranding, ClubSettings, FileRecord, MeetingFull, Page } from "@shared/types";
import { clubApi } from "@/components/records";
import { Alert, Badge, Button, buttonClass, Card, Checkbox, cx, Field, Input, SectionTitle, Select, Spinner, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { BRASS, checkAccent, FOREST, isHexColor, LINEN, useClubAccent } from "@/lib/branding";
import { formatDateTime } from "@/lib/format";
import { resizeImageFile, uploadFile } from "@/lib/upload";
import { JoinRequestsPanel, newQuestionKey, ScreeningQuestionsEditor, type DraftQuestion } from "./Joining";

/** `GET /api/clubs/:id` carries `branding` since wave 2; the shared Club type does not list it yet. */
export type ClubWithBranding = Club & { branding?: ClubBranding | null };

/** Banner URLs are `/api/clubs/:clubId/files/:fileId/content`; the PUT wants the file id back. */
export function bannerFileIdFromUrl(url: string | null | undefined): string | null {
  const m = url ? /\/files\/([^/?#]+)\/content/.exec(url) : null;
  return m?.[1] ?? null;
}

/** `GET /settings` also returns the club's `version`, which the PUT expects back. */
type LoadedSettings = ClubSettings & { version?: number };

export function useClubSettings(clubId: string) {
  return useQuery({ queryKey: ["club-settings", clubId], queryFn: () => api<LoadedSettings>(clubApi(clubId, "/settings")) });
}

function useSaveSettings(club: Club) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: Partial<ClubSettings> & { discordWebhookUrl?: string | null; expectedVersion?: number }) =>
      api<ClubSettings>(clubApi(club.id, "/settings"), { method: "PUT", body: { ...body, expectedVersion: body.expectedVersion ?? club.version } }),
    onSuccess: (saved) => {
      qc.setQueryData(["club-settings", club.id], saved);
      void qc.invalidateQueries({ queryKey: ["club", club.id] });
      void qc.invalidateQueries({ queryKey: ["club-settings", club.id] });
      toast("Settings saved.");
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.status === 409) {
        void qc.invalidateQueries({ queryKey: ["club", club.id] });
        void qc.invalidateQueries({ queryKey: ["club-settings", club.id] });
        toast("Someone else changed the settings first. The latest version is shown; try again.", "error");
        return;
      }
      toast(errorMessage(err), "error");
    },
  });
}

/** Settings body built from the loaded settings with one section replaced, so saving one tab never resets another. */
function withSection(s: LoadedSettings, patch: Partial<ClubSettings> & { discordWebhookUrl?: string | null }) {
  return {
    expectedVersion: s.version,
    welcomeMessage: s.welcomeMessage,
    joinPolicy: s.joinPolicy,
    screeningQuestions: s.screeningQuestions.map((q) => ({ id: q.id, label: q.label, required: q.required })),
    timezone: s.timezone,
    reminderOffsets: s.reminderOffsets,
    rolesRotation: s.rolesRotation,
    ...patch,
  };
}

// --- Branding -------------------------------------------------------------------------------------

const SWATCHES = [BRASS, "#9A3B2E", "#3F5F8A", "#3E7B5A", "#7B4F9D", "#C96A2B", "#2E6F8E", "#8A6D3B"];

export function BrandingTab({ club }: { club: ClubWithBranding }) {
  const qc = useQueryClient();
  const toast = useToast();
  const branding = club.branding ?? { bannerUrl: null, accentColor: null };
  const [accent, setAccent] = useState(branding.accentColor ?? "");
  const [bannerFile, setBannerFile] = useState<FileRecord | null>(null);
  const [bannerRemoved, setBannerRemoved] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl]);
  const valid = accent === "" || isHexColor(accent);
  const check = isHexColor(accent) ? checkAccent(accent) : null;
  // Preview the accent live on this page only; ClubLayout applies the saved one for the whole club.
  useClubAccent(isHexColor(accent) ? accent : null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setProgress(0);
      const prepared = await resizeImageFile(file, 2000);
      return uploadFile<FileRecord>(clubApi(club.id, "/files"), prepared, { fields: { kind: "banner", title: `${club.name} banner` }, onProgress: setProgress });
    },
    onSuccess: (rec, file) => {
      setBannerFile(rec);
      setBannerRemoved(false);
      setPreviewUrl(URL.createObjectURL(file));
      setProgress(null);
    },
    onError: (err) => {
      setProgress(null);
      toast(errorMessage(err), "error");
    },
  });
  const save = useMutation({
    mutationFn: () =>
      api<Club>(clubApi(club.id, "/branding"), {
        method: "PUT",
        body: { accentColor: accent || null, bannerFileId: bannerRemoved ? null : (bannerFile?.id ?? bannerFileIdFromUrl(branding.bannerUrl)), expectedVersion: club.version },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["club", club.id] });
      void qc.invalidateQueries({ queryKey: ["me"] });
      setBannerFile(null);
      setBannerRemoved(false);
      toast("Branding saved.");
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const shownBanner = bannerRemoved ? null : (previewUrl ?? branding.bannerUrl);
  const dirty = accent !== (branding.accentColor ?? "") || !!bannerFile || bannerRemoved;
  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <SectionTitle as="h2">Banner</SectionTitle>
        <p className="text-sm text-ink-muted">Shown across the top of the club. Landscape photos work best; the image is fitted to the space, never cropped by hand.</p>
        <div className="relative aspect-[3/1] w-full overflow-hidden rounded-card border border-line bg-surface-2">
          {shownBanner ? (
            <img src={shownBanner} alt={`${club.name} banner`} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-sm text-ink-muted">No banner yet</div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 bg-gradient-to-t from-forest/70 to-transparent p-4">
            <span className="font-display text-2xl font-semibold text-linen">{club.name}</span>
            <span className="mb-1.5 h-1 w-16 rounded-[2px]" style={{ background: "var(--club-accent, var(--color-accent))" }} aria-hidden />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className={buttonClass("secondary", "sm", "cursor-pointer")}>
            <Upload className="size-4" aria-hidden /> {progress != null ? `Uploading ${Math.round(progress * 100)}%` : "Upload banner"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={progress != null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                e.target.value = "";
              }}
            />
          </label>
          {shownBanner && (
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              onClick={() => {
                setBannerFile(null);
                setBannerRemoved(true);
              }}
            >
              Remove banner
            </Button>
          )}
        </div>
      </Card>

      <Card className="space-y-4">
        <SectionTitle as="h2">Accent colour</SectionTitle>
        <p className="text-sm text-ink-muted">One colour for the club's bands, badges and progress bars. Forest and Linen stay as they are, so pick something that reads against both.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Hex colour" error={valid ? undefined : "Use a colour like #B8903F"}>
            {(id) => (
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick a colour"
                  className="size-11 cursor-pointer rounded-control border border-line bg-surface p-1"
                  value={isHexColor(accent) ? accent : BRASS}
                  onChange={(e) => setAccent(e.target.value.toUpperCase())}
                />
                <Input id={id} className="w-36 font-mono uppercase" maxLength={7} placeholder="#B8903F" value={accent} invalid={!valid} onChange={(e) => setAccent(e.target.value.trim())} />
              </div>
            )}
          </Field>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Suggested colours">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Use ${c}`}
                aria-pressed={accent.toUpperCase() === c.toUpperCase()}
                className={cx("size-8 rounded-chip border", accent.toUpperCase() === c.toUpperCase() ? "border-ink ring-2 ring-ink ring-offset-1" : "border-line")}
                style={{ background: c }}
                onClick={() => setAccent(c)}
              />
            ))}
            {accent && (
              <Button size="sm" variant="ghost" onClick={() => setAccent("")}>
                Use Brass
              </Button>
            )}
          </div>
        </div>
        {check && (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Alert tone={check.linenOk || check.forestOk ? "info" : "warning"}>
              <p>{check.summary}</p>
              <p className="mt-1 text-xs text-ink-muted">
                On Linen {check.onLinen.toFixed(1)}:1 {check.linenOk ? "(fine)" : "(low)"} · on Forest {check.onForest.toFixed(1)}:1 {check.forestOk ? "(fine)" : "(low)"}. 2.5:1 is the floor for bands and progress fills; text always stays Forest or Linen.
              </p>
            </Alert>
            <div className="flex items-center gap-2" aria-label="Preview">
              <span className="inline-flex items-center gap-1.5 rounded-chip border border-line px-2 py-1 text-xs font-semibold" style={{ background: LINEN, color: FOREST }}>
                <Palette className="size-3.5" style={{ color: accent }} aria-hidden /> Reading
                <span className="ml-1 inline-block h-1 w-8 rounded-[2px]" style={{ background: accent }} />
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-chip border border-line px-2 py-1 text-xs font-semibold" style={{ background: FOREST, color: LINEN }}>
                <Palette className="size-3.5" style={{ color: accent }} aria-hidden /> Reading
                <span className="ml-1 inline-block h-1 w-8 rounded-[2px]" style={{ background: accent }} />
              </span>
            </div>
          </div>
        )}
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Button loading={save.isPending} disabled={!valid || !dirty} onClick={() => save.mutate()}>
          Save branding
        </Button>
      </Card>
    </div>
  );
}

// --- Joining ---------------------------------------------------------------------------------------

export function JoiningTab({ club }: { club: Club }) {
  const settings = useClubSettings(club.id);
  const save = useSaveSettings(club);
  const s = settings.data;
  const [policy, setPolicy] = useState<ClubSettings["joinPolicy"]>("link");
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [welcome, setWelcome] = useState("");
  const [previewWelcome, setPreviewWelcome] = useState(false);
  useEffect(() => {
    if (!s) return;
    setPolicy(s.joinPolicy);
    setQuestions(s.screeningQuestions.map((q) => ({ ...q, key: q.id || newQuestionKey() })));
    setWelcome(s.welcomeMessage ?? "");
  }, [s]);
  if (settings.isPending) return <Spinner />;
  if (settings.isError || !s) return <Alert tone="error">{errorMessage(settings.error)}</Alert>;
  const emptyQuestion = questions.some((q) => !q.label.trim());
  const submitJoining = () =>
    save.mutate(withSection(s, { joinPolicy: policy, screeningQuestions: questions.filter((q) => q.label.trim()).map((q) => ({ id: q.id ?? q.key, label: q.label.trim(), required: q.required })) }));
  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <SectionTitle as="h2">How people join</SectionTitle>
        <fieldset className="space-y-2">
          <legend className="sr-only">Join policy</legend>
          {(
            [
              { value: "link", title: "Anyone with an invite link joins straight away", body: "Best for clubs that know everyone they invite." },
              { value: "approval", title: "Invite links create a request an admin approves", body: "Ask a few questions first. Admins see the answers and approve or decline." },
            ] as const
          ).map((o) => (
            <label key={o.value} className={cx("flex cursor-pointer items-start gap-3 rounded-control border p-3", policy === o.value ? "border-ink bg-surface-2" : "border-line")}>
              <input type="radio" name="joinPolicy" className="mt-1 accent-[var(--color-primary)]" value={o.value} checked={policy === o.value} onChange={() => setPolicy(o.value)} />
              <span>
                <span className="block text-sm font-medium">{o.title}</span>
                <span className="block text-xs text-ink-muted">{o.body}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {policy === "approval" && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Screening questions</p>
            <ScreeningQuestionsEditor value={questions} onChange={setQuestions} />
          </div>
        )}
        <Button loading={save.isPending} disabled={policy === "approval" && emptyQuestion} onClick={submitJoining}>
          Save joining
        </Button>
        {policy === "approval" && emptyQuestion && <p className="text-xs text-error">Fill in or remove the blank question.</p>}
      </Card>

      {policy === "approval" && (
        <Card>
          <SectionTitle as="h2">Join requests</SectionTitle>
          <JoinRequestsPanel clubId={club.id} />
        </Card>
      )}

      <Card className="space-y-4">
        <SectionTitle
          as="h2"
          action={
            <Button size="sm" variant="ghost" icon={Eye} aria-pressed={previewWelcome} onClick={() => setPreviewWelcome((v) => !v)}>
              {previewWelcome ? "Edit" : "Preview"}
            </Button>
          }
        >
          Welcome message
        </SectionTitle>
        <p className="text-sm text-ink-muted">Posted in the club chat for each newcomer, and sent to them as a message from the owner. Leave it blank to skip.</p>
        {previewWelcome ? (
          <div className="rounded-control border border-line bg-ground p-4 text-sm">
            <p className="mb-1 text-xs text-ink-muted">Preview, as a new member sees it</p>
            <p className="whitespace-pre-wrap">
              <span className="font-semibold">@newmember</span> {welcome || <span className="text-ink-muted">(nothing yet)</span>}
            </p>
          </div>
        ) : (
          <Field label="Message" hint={`${welcome.length} of ${WAVE2_LIMITS.welcomeMessageMax}`}>
            {(id, d) => <Textarea id={id} aria-describedby={d} rows={4} maxLength={WAVE2_LIMITS.welcomeMessageMax} value={welcome} onChange={(e) => setWelcome(e.target.value)} placeholder="Welcome to the shelf. We meet on the first Thursday; the current book is pinned in Messages." />}
          </Field>
        )}
        <Button loading={save.isPending} disabled={welcome === (s.welcomeMessage ?? "")} onClick={() => save.mutate(withSection(s, { welcomeMessage: welcome || null }))}>
          Save welcome
        </Button>
      </Card>
    </div>
  );
}

// --- Reminders & roles ----------------------------------------------------------------------------------

const OFFSETS: { value: number; label: string }[] = [
  { value: 15, label: "15 minutes" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 360, label: "6 hours" },
  { value: 1440, label: "1 day" },
  { value: 2880, label: "2 days" },
  { value: 10080, label: "1 week" },
];

function timezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Tokyo", "Australia/Sydney"];
  }
}

export function RemindersTab({ club }: { club: Club }) {
  const settings = useClubSettings(club.id);
  const save = useSaveSettings(club);
  const s = settings.data;
  const [offsets, setOffsets] = useState<number[]>([]);
  const [rotation, setRotation] = useState({ host: true, picker: true, notetaker: true });
  const [tz, setTz] = useState("");
  const zones = useMemo(() => timezones(), []);
  useEffect(() => {
    if (!s) return;
    setOffsets(s.reminderOffsets);
    setRotation(s.rolesRotation);
    setTz(s.timezone);
  }, [s]);
  if (settings.isPending) return <Spinner />;
  if (settings.isError || !s) return <Alert tone="error">{errorMessage(settings.error)}</Alert>;
  const toggleOffset = (v: number) => setOffsets((o) => (o.includes(v) ? o.filter((x) => x !== v) : o.length >= 4 ? o : [...o, v].sort((a, b) => b - a)));
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <Card className="space-y-6">
      <div className="space-y-3">
        <SectionTitle as="h2">Meeting reminders</SectionTitle>
        <p className="text-sm text-ink-muted">Members who have not said no get a nudge before each meeting: in the app, by push, and by email or text where they have asked for it. Up to four.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Reminder times before a meeting">
          {OFFSETS.map((o) => {
            const on = offsets.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                disabled={!on && offsets.length >= 4}
                onClick={() => toggleOffset(o.value)}
                className={cx("rounded-chip border px-3 py-1.5 text-sm font-medium disabled:opacity-50", on ? "border-ink bg-primary text-on-primary" : "border-line hover:bg-surface-2")}
              >
                {o.label} before
              </button>
            );
          })}
        </div>
        {offsets.length === 0 && <p className="text-xs text-ink-muted">No reminders will be sent.</p>}
      </div>
      <div className="space-y-3">
        <SectionTitle as="h2">Club time zone</SectionTitle>
        <Field label="Time zone" hint={tz !== localZone ? `Your device is on ${localZone}. Meeting times are shown to each member in their own zone.` : "Used when the club schedules meetings and sends reminders."}>
          {(id, d) => (
            <Select id={id} aria-describedby={d} value={tz} onChange={(e) => setTz(e.target.value)}>
              {!zones.includes(tz) && tz && <option value={tz}>{tz}</option>}
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="space-y-3">
        <SectionTitle as="h2">Rotating roles</SectionTitle>
        <p className="text-sm text-ink-muted">When a meeting is created with roles turned on, the member who has done it least (then longest ago) is suggested first.</p>
        <Checkbox label="Rotate the host" checked={rotation.host} onChange={(e) => setRotation({ ...rotation, host: e.target.checked })} />
        <Checkbox label="Rotate who picks the next book" checked={rotation.picker} onChange={(e) => setRotation({ ...rotation, picker: e.target.checked })} />
        <Checkbox label="Rotate the note-taker" checked={rotation.notetaker} onChange={(e) => setRotation({ ...rotation, notetaker: e.target.checked })} />
      </div>
      <Button loading={save.isPending} onClick={() => save.mutate(withSection(s, { reminderOffsets: offsets, rolesRotation: rotation, timezone: tz }))}>
        Save reminders
      </Button>
    </Card>
  );
}

// --- Bridge (Discord) ------------------------------------------------------------------------------------

export function BridgeTab({ club }: { club: Club }) {
  const toast = useToast();
  const settings = useClubSettings(club.id);
  const save = useSaveSettings(club);
  const [url, setUrl] = useState("");
  const [editing, setEditing] = useState(false);
  const s = settings.data;
  const meetings = useQuery({
    queryKey: ["meetings", club.id, "upcoming", "for-bridge"],
    queryFn: async () => {
      const res = await api<MeetingFull[] | Page<MeetingFull>>(clubApi(club.id, "/meetings?when=upcoming"));
      return Array.isArray(res) ? res : res.items;
    },
    enabled: !!s?.discordWebhookConfigured,
  });
  const test = useMutation({
    mutationFn: (meetingId: string) => api(clubApi(club.id, "/bridge/discord"), { body: { kind: "meeting", id: meetingId } }),
    onSuccess: () => toast("Posted to Discord."),
    onError: (err) => toast(errorMessage(err), "error"),
  });
  if (settings.isPending) return <Spinner />;
  if (settings.isError || !s) return <Alert tone="error">{errorMessage(settings.error)}</Alert>;
  const valid = url.startsWith("https://discord.com/api/webhooks/") && url.length > 40;
  const configured = s.discordWebhookConfigured;
  const next = meetings.data?.[0];
  const submit = (value: string | null) =>
    save.mutate(withSection(s, { discordWebhookUrl: value }), {
      onSuccess: () => {
        setUrl("");
        setEditing(false);
      },
    });
  return (
    <Card className="space-y-4">
      <SectionTitle as="h2">Discord</SectionTitle>
      <p className="text-sm text-ink-muted">
        Post meetings, polls and assignments to a Discord channel. In Discord, open the channel settings, choose Integrations, create a webhook and paste its URL here. The URL is stored but never shown again.
      </p>
      <div className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-ground p-4">
        <Link2 className="size-5 text-ink-muted" aria-hidden strokeWidth={1.75} />
        <p className="min-w-0 flex-1 text-sm font-medium">Webhook</p>
        <Badge tone={configured ? "success" : "neutral"}>{configured ? "Configured" : "Not set"}</Badge>
        {configured && !editing && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Replace
            </Button>
            <Button size="sm" variant="ghost" icon={Trash2} loading={save.isPending} onClick={() => confirm("Remove the Discord webhook?") && submit(null)}>
              Clear
            </Button>
          </>
        )}
      </div>
      {(!configured || editing) && (
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) submit(url);
          }}
        >
          <Field label="Webhook URL" error={url && !valid ? "Discord webhook URLs start with https://discord.com/api/webhooks/" : undefined}>
            {(id) => <Input id={id} type="url" autoComplete="off" spellCheck={false} placeholder="https://discord.com/api/webhooks/…" value={url} invalid={!!url && !valid} onChange={(e) => setUrl(e.target.value.trim())} />}
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending} disabled={!valid}>
              Save webhook
            </Button>
            {editing && (
              <Button variant="ghost" onClick={() => (setEditing(false), setUrl(""))}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
      {configured && (
        <div className="space-y-2 border-t border-line pt-4">
          <p className="text-sm font-medium">Test post</p>
          {meetings.isPending ? (
            <Spinner />
          ) : next ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-ink-muted">
                Posts the next meeting, {next.title} on {formatDateTime(next.startsAt)}, to the channel.
              </p>
              <Button size="sm" variant="secondary" icon={Send} loading={test.isPending} onClick={() => test.mutate(next.id)}>
                Send test
              </Button>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Schedule a meeting and you can send it to Discord from here or from the meeting page.</p>
          )}
        </div>
      )}
    </Card>
  );
}

// --- Export ---------------------------------------------------------------------------------------------

export function ExportTab({ club }: { club: Club }) {
  return (
    <Card className="space-y-3">
      <SectionTitle as="h2">Export members</SectionTitle>
      <p className="text-sm text-ink-muted">A CSV with each member's name, username, email, role, join date, meetings attended in the last twelve months and books finished this year. For admins only; treat it as you would any list of people's addresses.</p>
      <a href={clubApi(club.id, "/members/export.csv")} download={`${club.slug || "club"}-members.csv`} className={buttonClass("secondary")}>
        <Download className="size-4" aria-hidden /> Download CSV
      </a>
    </Card>
  );
}
