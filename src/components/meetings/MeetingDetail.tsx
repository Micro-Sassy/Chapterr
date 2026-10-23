import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ArrowLeft, CalendarPlus, ChevronDown, Copy, ExternalLink, FileText, MapPin, Pencil, Repeat, Send, Share2, Video } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { MeetingDetail, MeetingFull, MeetingScope } from "@shared/types";
import { BookCover } from "@/components/BookCover";
import { AuditLine, clubApi, useSharedMutation } from "@/components/records";
import { Alert, Badge, Button, EmptyState, PageHeader, Spinner, TextLink } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { describeRecurrence, formatMeetingWhen, viewerTimeNote } from "@/lib/calendar";
import { clubPath, isAdmin, useClub } from "@/lib/club";
import { useDocumentTitle } from "@/lib/hooks";
import { canManageMeeting, meetingInvalidations, useClubSettings, useClubTimezone, useMeeting } from "./api";
import { AttendancePanel } from "./AttendancePanel";
import { CopyMeetingDialog } from "./CopyMeetingDialog";
import { MeetingForm } from "./MeetingForm";
import { MeetingPackDrawer } from "./MeetingPack";
import { NotesPanel } from "./NotesPanel";
import { RolesPanel } from "./RolesPanel";
import { RsvpPanel } from "./RsvpPanel";
import { ShareSheet } from "./ShareSheet";
import { SignupLists } from "./SignupLists";

const isVideoLink = (url: string) => /zoom|meet\.google|teams|webex|whereby|facetime|jitsi/i.test(url);

function ScopeDialog({ open, onClose, title, onPick, busy }: { open: boolean; onClose: () => void; title: string; onPick: (scope: MeetingScope) => void; busy: boolean }) {
  const [scope, setScope] = useState<MeetingScope>("this");
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Which meetings" className="space-y-1.5 text-sm">
          {(["this", "future", "all"] as MeetingScope[]).map((s) => (
            <label key={s} className="flex items-center gap-2">
              <input type="radio" name="archive-scope" checked={scope === s} onChange={() => setScope(s)} />
              {s === "this" ? "This meeting only" : s === "future" ? "This and future meetings" : "Every meeting in the series"}
            </label>
          ))}
        </div>
        <Button loading={busy} onClick={() => onPick(scope)}>
          Continue
        </Button>
      </div>
    </Dialog>
  );
}

export function MeetingDetailPage() {
  const club = useClub();
  const { meetingId } = useParams();
  const tz0 = useClubTimezone();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const session = useSession();
  const settings = useClubSettings(club.id);
  const q = useMeeting(club.id, meetingId);
  const [editing, setEditing] = useState(false);
  const [copying, setCopying] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [archiveScope, setArchiveScope] = useState(false);
  useDocumentTitle(q.data ? `${q.data.title} · ${club.name}` : "Meeting");

  const archive = useSharedMutation(
    (v: { m: MeetingDetail; scope: MeetingScope }) => api(clubApi(club.id, `/meetings/${v.m.id}/${v.m.archivedAt ? "restore" : "archive"}?scope=${v.scope}`), { body: { expectedVersion: v.m.version } }),
    meetingInvalidations(club.id),
  );
  const discord = useSharedMutation((id: string) => api(clubApi(club.id, "/bridge/discord"), { body: { kind: "meeting", id } }), [], "Posted to Discord.");

  if (q.isPending) return <Spinner label="Opening the meeting" />;
  if (q.isError) {
    return (
      <EmptyState title="Couldn't open this meeting" action={<Button onClick={() => navigate(clubPath(club.id, "meetings"))}>All meetings</Button>}>
        {errorMessage(q.error)}
      </EmptyState>
    );
  }
  const m = q.data;
  const tz = m.timezone ?? tz0;
  const admin = isAdmin(club);
  const canManage = canManageMeeting(club, m, session.data?.user.id);
  const viewerNote = viewerTimeNote(m.startsAt, tz);
  const discordReady = settings.data ? settings.data.discordWebhookConfigured : true;
  const doArchive = (scope: MeetingScope) =>
    archive.mutate(
      { m, scope },
      {
        onSuccess: () => {
          setArchiveScope(false);
          toast(m.archivedAt ? "Meeting restored." : "Meeting archived.");
          if (!m.archivedAt) navigate(clubPath(club.id, "meetings"));
        },
      },
    );

  return (
    <div className="space-y-6">
      <TextLink to={clubPath(club.id, "meetings")} className="inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" aria-hidden /> All meetings
      </TextLink>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            {club.name}
            {m.seriesId && (
              <Badge tone="info">
                <Repeat className="size-3" aria-hidden /> {m.occurrence ? `Meeting ${m.occurrence.index} of ${m.occurrence.total}` : "Series"}
              </Badge>
            )}
            {m.archivedAt && <Badge>Archived</Badge>}
            {m.copiedFromId && <Badge>Copied</Badge>}
          </span>
        }
        title={m.title}
        description={
          <span className="space-y-1">
            <span className="block text-ink">{formatMeetingWhen(m.startsAt, m.endsAt, tz)}</span>
            {viewerNote && <span className="block text-sm">{viewerNote}</span>}
            {m.recurrence && <span className="block text-sm">{describeRecurrence(m.recurrence, m.startsAt, tz)}</span>}
            {(m.location || m.locationUrl) && (
              <span className="flex flex-wrap items-center gap-1.5">
                {m.locationUrl && isVideoLink(m.locationUrl) ? <Video className="size-4" aria-hidden /> : <MapPin className="size-4" aria-hidden />}
                {m.location ?? "Online"}
                {m.locationUrl && (
                  <a href={m.locationUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-ink underline decoration-line underline-offset-2 hover:decoration-ink">
                    {isVideoLink(m.locationUrl) ? "Join call" : "Open map"} <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" icon={FileText} onClick={() => setPackOpen(true)}>
              Meeting pack
            </Button>
            <Menu
              label="Meeting actions"
              align="end"
              trigger={(props) => (
                <Button variant="secondary" {...props}>
                  Actions <ChevronDown className="size-4" aria-hidden />
                </Button>
              )}
            >
              {!m.archivedAt && (
                <MenuItem icon={Pencil} onClick={() => setEditing(true)}>
                  Edit meeting
                </MenuItem>
              )}
              <MenuItem icon={Copy} onClick={() => setCopying(true)}>
                Copy meeting
              </MenuItem>
              <MenuItem
                icon={CalendarPlus}
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = clubApi(club.id, `/meetings/${m.id}.ics`);
                  a.download = `${m.title.replace(/[^\w\s-]+/g, "").trim() || "meeting"}.ics`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                }}
              >
                Download .ics
              </MenuItem>
              <MenuItem icon={Share2} onClick={() => setSharing(true)}>
                Share
              </MenuItem>
              {admin && discordReady && (
                <MenuItem icon={Send} onClick={() => discord.mutate(m.id)}>
                  Post to Discord
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem icon={m.archivedAt ? ArchiveRestore : Archive} onClick={() => (m.seriesId ? setArchiveScope(true) : doArchive("this"))}>
                {m.archivedAt ? "Restore meeting" : "Archive meeting"}
              </MenuItem>
            </Menu>
          </>
        }
      />

      {m.archivedAt && <Alert tone="warning">This meeting is archived. Restore it from the actions menu to make changes.</Alert>}

      {(m.edition || m.details) && (
        <div className="flex flex-wrap items-start gap-5">
          {m.edition && (
            <div className="flex items-center gap-3">
              <BookCover url={m.edition.coverUrl} title={m.edition.title} size="md" />
              <div>
                <p className="label text-ink-muted">Discussing</p>
                <Link to={`/books/${m.edition.id}`} className="book-title text-xl hover:underline">
                  {m.edition.title}
                </Link>
                <p className="text-sm text-ink-muted">{m.edition.authors.join(", ")}</p>
                <TextLink to={clubPath(club.id, `rooms/${m.edition.id}`)} className="mt-1 inline-block text-sm">
                  Discussion rooms
                </TextLink>
              </div>
            </div>
          )}
          {m.details && <p className="max-w-prose whitespace-pre-wrap text-[15px] leading-relaxed">{m.details}</p>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <RsvpPanel meeting={m} clubId={club.id} tz={tz} />
        <div className="space-y-4">
          <RolesPanel meeting={m} clubId={club.id} canManage={canManage} />
          <AttendancePanel meeting={m} clubId={club.id} canManage={canManage} />
        </div>
      </div>
      <NotesPanel key={`${m.id}-${m.version}`} meeting={m} clubId={club.id} />
      <SignupLists meeting={m} clubId={club.id} />
      <p>
        <AuditLine item={m} />
      </p>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit meeting" wide>
        {editing && (
          <MeetingForm
            clubId={club.id}
            initial={m}
            onDone={() => {
              setEditing(false);
              void qc.invalidateQueries({ queryKey: ["meeting", club.id, m.id] });
            }}
          />
        )}
      </Dialog>
      {copying && (
        <CopyMeetingDialog
          open={copying}
          onClose={() => setCopying(false)}
          meeting={m}
          clubId={club.id}
          tz={tz}
          onCopied={(created: MeetingFull) => {
            setCopying(false);
            if (created?.id) navigate(clubPath(club.id, `meetings/${created.id}`));
          }}
        />
      )}
      <ShareSheet open={sharing} onClose={() => setSharing(false)} clubId={club.id} meetingId={m.id} />
      <MeetingPackDrawer open={packOpen} onClose={() => setPackOpen(false)} meeting={m} clubId={club.id} tz={tz} />
      <ScopeDialog open={archiveScope} onClose={() => setArchiveScope(false)} title={m.archivedAt ? "Restore which meetings" : "Archive which meetings"} onPick={doArchive} busy={archive.isPending} />
    </div>
  );
}
