import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Images } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { WAVE2_LIMITS, type FileKind } from "@shared/constants";
import type { FileRecord, FileUsage, MeetingFull, Page } from "@shared/types";
import { FILE_KIND_LABELS, FileUploader, PICKABLE_KINDS } from "@/components/files/FileUploader";
import { DocumentList, isPhoto, PhotoGrid, StorageBar } from "@/components/files/FileViews";
import { clubApi } from "@/components/records";
import { Alert, Button, Card, EmptyState, PageHeader, SectionTitle, Spinner, Tabs } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { isAdmin, useClub } from "@/lib/club";
import { useDocumentTitle } from "@/lib/hooks";

type Filter = "all" | FileKind;

/** Meetings list for file grouping; tolerant of the plain-array or paged shape. */
export function useClubMeetings(clubId: string) {
  return useQuery({
    queryKey: ["meetings", clubId, "all", "for-files"],
    queryFn: async () => {
      const res = await api<MeetingFull[] | Page<MeetingFull>>(clubApi(clubId, "/meetings?when=all"));
      return Array.isArray(res) ? res : res.items;
    },
    staleTime: 5 * 60_000,
  });
}

export function FilesPage() {
  const club = useClub();
  useDocumentTitle(`Files · ${club.name}`);
  const qc = useQueryClient();
  const toast = useToast();
  const { data: session } = useSession();
  const [params, setParams] = useSearchParams();
  const filter = (params.get("kind") as Filter | null) ?? "all";
  const meetingParam = params.get("meetingId") ?? "";
  const [showUpload, setShowUpload] = useState(params.get("upload") === "1");

  const files = useQuery({
    queryKey: ["club-files", club.id, meetingParam],
    queryFn: async () => {
      const items: FileRecord[] = [];
      let cursor: string | null = null;
      // Walk every page: the club limit is 200 files, so this stays small.
      for (let i = 0; i < 10; i++) {
        const qs = new URLSearchParams();
        if (meetingParam) qs.set("meetingId", meetingParam);
        if (cursor) qs.set("cursor", cursor);
        const page: Page<FileRecord> = await api<Page<FileRecord>>(clubApi(club.id, `/files${qs.size ? `?${qs}` : ""}`));
        items.push(...page.items);
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      return items;
    },
  });
  const usage = useQuery({ queryKey: ["club-files-usage", club.id], queryFn: () => api<FileUsage>(clubApi(club.id, "/files/usage")), retry: false });
  const meetings = useClubMeetings(club.id);

  const remove = useMutation({
    mutationFn: (f: FileRecord) => api(clubApi(club.id, `/files/${f.id}`), { method: "DELETE" }),
    onSuccess: (_d, f) => {
      qc.setQueryData<FileRecord[]>(["club-files", club.id, meetingParam], (prev) => prev?.filter((x) => x.id !== f.id));
      void qc.invalidateQueries({ queryKey: ["club-files", club.id] });
      void qc.invalidateQueries({ queryKey: ["club-files-usage", club.id] });
      toast(`${f.title} deleted.`);
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });

  const all = useMemo(() => files.data ?? [], [files.data]);
  const visible = useMemo(() => (filter === "all" ? all : all.filter((f) => f.kind === filter)), [all, filter]);
  const photos = visible.filter(isPhoto);
  const documents = visible.filter((f) => !isPhoto(f));
  const counts = useMemo(() => {
    const c = new Map<Filter, number>([["all", all.length]]);
    for (const f of all) c.set(f.kind, (c.get(f.kind) ?? 0) + 1);
    return c;
  }, [all]);
  const fallbackUsage = { files: all.length, bytes: all.reduce((n, f) => n + f.size, 0) };
  const perFileMax = usage.data?.perFileMax ?? WAVE2_LIMITS.fileBytesMaxD1;
  const admin = isAdmin(club);
  const meetingList = meetings.data ?? [];
  const scopedMeeting = meetingParam ? meetingList.find((m) => m.id === meetingParam) : undefined;

  const setFilter = (f: Filter) => {
    const next = new URLSearchParams(params);
    if (f === "all") next.delete("kind");
    else next.set("kind", f);
    setParams(next);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={club.name}
        title="Files"
        description={scopedMeeting ? `Files for ${scopedMeeting.title}.` : "Minutes, photos, recipes and documents the club wants to keep."}
        actions={
          <Button icon={FolderOpen} variant={showUpload ? "secondary" : "primary"} onClick={() => setShowUpload((v) => !v)} aria-expanded={showUpload}>
            {showUpload ? "Hide upload" : "Upload files"}
          </Button>
        }
      />
      {showUpload && (
        <Card>
          <SectionTitle as="h2">Add to the club's files</SectionTitle>
          <FileUploader clubId={club.id} meetings={meetingList} maxBytes={perFileMax} defaultMeetingId={meetingParam} defaultKind={filter !== "all" && PICKABLE_KINDS.includes(filter) ? filter : "document"} />
        </Card>
      )}
      <Card>
        <StorageBar usage={usage.data ?? null} fallback={fallbackUsage} />
      </Card>
      {scopedMeeting && (
        <Alert tone="info">
          Showing files for one meeting.{" "}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete("meetingId");
              setParams(next);
            }}
          >
            Show all files
          </button>
        </Alert>
      )}
      <Tabs
        label="Filter files by kind"
        value={filter}
        onChange={setFilter}
        tabs={[{ value: "all" as Filter, label: "All", count: counts.get("all") }, ...PICKABLE_KINDS.map((k) => ({ value: k as Filter, label: `${FILE_KIND_LABELS[k]}s`, count: counts.get(k) ?? 0 }))]}
      />
      {files.isPending && <Spinner label="Opening the files" />}
      {files.isError && <Alert tone="error">{errorMessage(files.error)}</Alert>}
      {files.isSuccess && visible.length === 0 && (
        <EmptyState icon={filter === "photo" ? Images : FolderOpen} title={all.length === 0 ? "Nothing here yet" : `No ${filter === "all" ? "files" : `${FILE_KIND_LABELS[filter as FileKind].toLowerCase()}s`} yet`} action={<Button onClick={() => setShowUpload(true)}>Upload files</Button>}>
          {all.length === 0 ? "Meeting minutes, photos from the last gathering, that one recipe everyone asked for." : "Upload one, or change the filter."}
        </EmptyState>
      )}
      {photos.length > 0 && (
        <section>
          <SectionTitle as="h2">Photos</SectionTitle>
          <PhotoGrid photos={photos} viewerId={session?.user.id} admin={admin} onDelete={(f) => remove.mutate(f)} deleting={remove.isPending ? remove.variables?.id : undefined} />
        </section>
      )}
      {documents.length > 0 && (
        <section>
          <SectionTitle as="h2">Documents</SectionTitle>
          <Card className="py-2 sm:py-2">
            <DocumentList files={documents} meetings={meetingList} clubId={club.id} viewerId={session?.user.id} admin={admin} onDelete={(f) => remove.mutate(f)} deleting={remove.isPending ? remove.variables?.id : undefined} />
          </Card>
        </section>
      )}
    </div>
  );
}
