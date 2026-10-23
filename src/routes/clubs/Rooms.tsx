import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpenText, DoorOpen, Lock, Pencil, Plus, Sparkles, Trash2, WandSparkles } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { GATE_TYPES, ROOM_KINDS, WAVE2_LIMITS, type GateType, type RoomKind } from "@shared/constants";
import type { ClubReadingProgress, DiscussionGuide, DiscussionRoom, EditionSummary, GuideSection, MemberProgress } from "@shared/types";
import { Avatar } from "@/components/Avatar";
import { BookCover } from "@/components/BookCover";
import { ChatConversation } from "@/components/chat/ChatConversation";
import { gateLabel, lockedCopy, progressLabel, ROOM_KIND_LABELS } from "@/components/chat/gate";
import { GuideEditor } from "@/components/chat/GuideEditor";
import { ProgressControl, type ProgressInput } from "@/components/chat/ProgressControl";
import { RoomCard } from "@/components/chat/RoomCard";
import { guideKey, progressAllKey, progressKey, roomKey, roomsKey } from "@/components/chat/types";
import { clubApi } from "@/components/records";
import { Alert, Badge, Button, Card, Checkbox, cx, EmptyState, Field, IconButton, Input, PageHeader, SectionTitle, Select, Spinner } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { authorsLine, todayIso } from "@/lib/format";
import { clubPath, isAdmin, useClub } from "@/lib/club";
import { useDocumentTitle } from "@/lib/hooks";

const GATE_LABELS: Record<GateType, string> = { none: "Open to everyone", chapter: "At a chapter", page: "At a page", percent: "At a percentage", finished: "When finished" };

// --- Data ---------------------------------------------------------------------------------

function useRooms(clubId: string, editionId: string) {
  return useQuery({ queryKey: roomsKey(clubId, editionId), queryFn: () => api<DiscussionRoom[]>(clubApi(clubId, `/books/${encodeURIComponent(editionId)}/rooms`)) });
}
function useProgress(clubId: string, editionId: string) {
  return useQuery({ queryKey: progressKey(clubId, editionId), queryFn: () => api<ClubReadingProgress>(clubApi(clubId, `/books/${encodeURIComponent(editionId)}/progress?today=${todayIso()}`)) });
}
function useProgressAll(clubId: string, editionId: string) {
  return useQuery({ queryKey: progressAllKey(clubId, editionId), queryFn: () => api<MemberProgress[]>(clubApi(clubId, `/books/${encodeURIComponent(editionId)}/progress/all`)) });
}
function useGuide(clubId: string, editionId: string) {
  return useQuery({
    queryKey: guideKey(clubId, editionId),
    queryFn: async () => {
      try {
        return await api<DiscussionGuide>(clubApi(clubId, `/books/${encodeURIComponent(editionId)}/guide`));
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 404) return null;
        throw err;
      }
    },
  });
}

function useInvalidateRooms(clubId: string, editionId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: roomsKey(clubId, editionId) });
    void qc.invalidateQueries({ queryKey: ["conversations", clubId] });
  };
}

// --- Member positions (spoiler-safe) ----------------------------------------------------

function MemberPositions({ members, mine }: { members: MemberProgress[]; mine: ClubReadingProgress | null | undefined }) {
  const total = members.length;
  if (total === 0) return null;
  const finished = members.filter((m) => m.progress.finished).length;
  const myChapter = mine?.chapter ?? null;
  let line: string;
  if (myChapter !== null && !mine?.finished) {
    const past = members.filter((m) => m.progress.finished || (m.progress.chapter ?? -1) > myChapter).length;
    line = `${past} of ${total} ${past === 1 ? "is" : "are"} past chapter ${myChapter}.`;
  } else {
    line = `${finished} of ${total} ${finished === 1 ? "has" : "have"} finished.`;
  }
  return (
    <div>
      <p className="text-sm text-ink-muted">{line}</p>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label="Where members are">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-1.5 rounded-chip border border-line bg-surface px-1.5 py-0.5 text-xs" title={`${m.displayName}: ${progressLabel(m.progress)}`}>
            <Avatar member={m} size="xs" />
            <span className="sr-only">{m.displayName}: </span>
            <span className="font-semibold tabular-nums">{m.progress.finished ? "Done" : m.progress.chapter !== null ? `Ch ${m.progress.chapter}` : m.progress.page !== null ? `p. ${m.progress.page}` : m.progress.percent !== null ? `${m.progress.percent}%` : "–"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Dialogs ---------------------------------------------------------------------------------

function SetupRoomsDialog({ clubId, editionId, open, onClose }: { clubId: string; editionId: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateRooms(clubId, editionId);
  const [chapters, setChapters] = useState("12");
  const [reflection, setReflection] = useState(true);
  const create = useMutation({
    mutationFn: () => api<DiscussionRoom[]>(clubApi(clubId, `/books/${encodeURIComponent(editionId)}/rooms/auto`), { body: { chapters: Number(chapters), reflection } }),
    onSuccess: () => {
      invalidate();
      toast("Rooms are ready.");
      onClose();
    },
  });
  const n = Number(chapters);
  const valid = Number.isInteger(n) && n >= 1 && n <= WAVE2_LIMITS.roomsPerBookMax - 1;
  return (
    <Dialog open={open} onClose={onClose} title="Set up rooms">
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">One room per chapter, each opening once a reader reaches it. The reflection room opens when the book is finished.</p>
        <Field label="Chapters" hint={`Up to ${WAVE2_LIMITS.roomsPerBookMax - 1}.`}>
          {(id, d) => <Input id={id} type="number" inputMode="numeric" min={1} max={WAVE2_LIMITS.roomsPerBookMax - 1} aria-describedby={d} value={chapters} onChange={(e) => setChapters(e.target.value)} />}
        </Field>
        <Checkbox label="Add a reflection room for the whole book" checked={reflection} onChange={(e) => setReflection(e.target.checked)} />
        {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={DoorOpen} loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>
            Create rooms
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function AddRoomDialog({ clubId, editionId, open, onClose }: { clubId: string; editionId: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateRooms(clubId, editionId);
  const [kind, setKind] = useState<RoomKind>("milestone");
  const [title, setTitle] = useState("");
  const [gateType, setGateType] = useState<GateType>("chapter");
  const [gateValue, setGateValue] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api<DiscussionRoom>(clubApi(clubId, `/books/${encodeURIComponent(editionId)}/rooms`), {
        body: { kind, title: title.trim(), gateType, gateValue: gateType === "none" || gateType === "finished" ? null : Number(gateValue) },
      }),
    onSuccess: () => {
      invalidate();
      toast("Room added.");
      setTitle("");
      onClose();
    },
  });
  const needsValue = gateType === "chapter" || gateType === "page" || gateType === "percent";
  const valid = title.trim().length > 0 && (!needsValue || (gateValue.trim() !== "" && Number(gateValue) >= 0));
  return (
    <Dialog open={open} onClose={onClose} title="Add room">
      <div className="space-y-4">
        <Field label="Kind">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as RoomKind)}>
              {ROOM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ROOM_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Title">{(id) => <Input id={id} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "milestone" ? "Part one" : kind === "reflection" ? "The whole book" : "Chapter 1"} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Opens">
            {(id) => (
              <Select id={id} value={gateType} onChange={(e) => setGateType(e.target.value as GateType)}>
                {GATE_TYPES.map((g) => (
                  <option key={g} value={g}>
                    {GATE_LABELS[g]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {needsValue && (
            <Field label={gateType === "chapter" ? "Chapter" : gateType === "page" ? "Page" : "Percent"}>
              {(id) => <Input id={id} type="number" inputMode="numeric" min={0} max={gateType === "percent" ? 100 : 100_000} value={gateValue} onChange={(e) => setGateValue(e.target.value)} />}
            </Field>
          )}
        </div>
        {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={Plus} loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>
            Add room
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function GenerateGuideDialog({ clubId, editionId, open, onClose, hasGuide, chapterCount }: { clubId: string; editionId: string; open: boolean; onClose: () => void; hasGuide: boolean; chapterCount: number | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [aiUnavailable, setAiUnavailable] = useState<string | null>(null);
  const [confirmSource, setConfirmSource] = useState<"template" | "ai" | null>(null);
  const generate = useMutation({
    mutationFn: (source: "template" | "ai") => api<DiscussionGuide>(clubApi(clubId, `/books/${encodeURIComponent(editionId)}/guide/generate`), { body: { source, chapters: chapterCount } }),
    onSuccess: (guide) => {
      qc.setQueryData(guideKey(clubId, editionId), guide);
      void qc.invalidateQueries({ queryKey: roomsKey(clubId, editionId) });
      toast(guide.source === "ai" ? "Guide written." : "Guide ready.");
      setConfirmSource(null);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.status === 409 && err.code === "ai_unavailable") setAiUnavailable(err.message || "Needs an API key.");
      setConfirmSource(null);
    },
  });
  const run = (source: "template" | "ai") => {
    if (hasGuide) setConfirmSource(source);
    else generate.mutate(source);
  };
  return (
    <Dialog open={open} onClose={onClose} title="Generate guide">
      {confirmSource ? (
        <div className="space-y-4">
          <p className="text-sm">This replaces the current guide with a new {confirmSource === "ai" ? "AI-written" : "template"} one. The old questions are not kept.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmSource(null)}>
              Keep current
            </Button>
            <Button loading={generate.isPending} onClick={() => generate.mutate(confirmSource)}>
              Replace guide
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => run("template")}
            disabled={generate.isPending}
            className="flex w-full items-start gap-3 rounded-card border border-line p-4 text-left hover:bg-surface-2 disabled:opacity-60"
          >
            <BookOpenText className="mt-0.5 size-5 shrink-0 text-ink-muted" aria-hidden strokeWidth={1.75} />
            <span>
              <span className="block font-semibold">From a template</span>
              <span className="block text-sm text-ink-muted">Twelve to eighteen questions shaped by the book's genres, title and description. Ready at once.</span>
            </span>
          </button>
          <div>
            <button
              type="button"
              onClick={() => run("ai")}
              disabled={generate.isPending || !!aiUnavailable}
              aria-describedby={aiUnavailable ? "ai-note" : undefined}
              className="flex w-full items-start gap-3 rounded-card border border-line p-4 text-left hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles className="mt-0.5 size-5 shrink-0 text-ink-muted" aria-hidden strokeWidth={1.75} />
              <span>
                <span className="block font-semibold">Written for this book</span>
                <span className="block text-sm text-ink-muted">Questions drafted by Claude from the title, authors and description. Takes a few seconds.</span>
              </span>
            </button>
            {aiUnavailable && (
              <p id="ai-note" className="mt-1.5 text-xs text-ink-muted" role="status">
                Needs an API key. {aiUnavailable}
              </p>
            )}
          </div>
          {generate.isPending && <Spinner label="Writing questions" />}
          {generate.isError && !(generate.error instanceof ApiRequestError && generate.error.code === "ai_unavailable") && <Alert tone="error">{errorMessage(generate.error)}</Alert>}
        </div>
      )}
    </Dialog>
  );
}

// --- Guide section ------------------------------------------------------------------------------

function GuideSectionView({ clubId, editionId, guide, rooms, chapterCount, canEdit }: { clubId: string; editionId: string; guide: DiscussionGuide | null; rooms: DiscussionRoom[]; chapterCount: number | null; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const save = useMutation({
    mutationFn: ({ sections, expectedVersion }: { sections: GuideSection[]; expectedVersion: number | undefined }) =>
      api<DiscussionGuide>(clubApi(clubId, `/books/${encodeURIComponent(editionId)}/guide`), { method: "PUT", body: { sections, expectedVersion } }),
    onSuccess: (g) => {
      qc.setQueryData(guideKey(clubId, editionId), g);
      void qc.invalidateQueries({ queryKey: roomsKey(clubId, editionId) });
      toast("Guide saved.");
      setEditing(false);
    },
  });
  const roomTitle = (id: string | null) => rooms.find((r) => r.id === id)?.title ?? null;
  const count = guide?.sections.reduce((n, s) => n + s.questions.length, 0) ?? 0;

  return (
    <section aria-labelledby="guide-heading">
      <SectionTitle
        action={
          canEdit ? (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon={WandSparkles} onClick={() => setGenerating(true)}>
                Generate
              </Button>
              {!editing && (
                <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                  {guide ? "Edit guide" : "Write guide"}
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        <span id="guide-heading">Discussion guide</span>
      </SectionTitle>
      {editing ? (
        <Card>
          <GuideEditor
            guide={guide}
            rooms={rooms}
            saving={save.isPending}
            error={save.isError ? (save.error instanceof ApiRequestError && save.error.status === 409 ? "Someone else saved the guide first. Reload to see their version." : errorMessage(save.error)) : null}
            onCancel={() => setEditing(false)}
            onSave={(sections, expectedVersion) => save.mutate({ sections, expectedVersion })}
          />
        </Card>
      ) : !guide || count === 0 ? (
        <EmptyState
          icon={BookOpenText}
          title="No guide yet"
          action={
            canEdit ? (
              <Button icon={WandSparkles} onClick={() => setGenerating(true)}>
                Generate
              </Button>
            ) : undefined
          }
        >
          {canEdit ? "A guide gives the club questions to carry into each room. Generate one, then shape it." : "A guide gives the club questions to carry into each room. An admin can generate one."}
        </EmptyState>
      ) : (
        <Card className="space-y-5">
          <p className="text-xs text-ink-muted">
            {count} {count === 1 ? "question" : "questions"} · {guide.source === "ai" ? "written for this book" : guide.source === "template" ? "from a template" : "written by the club"}
            {guide.updatedBy && ` · last edited by ${guide.updatedBy.displayName}`}
          </p>
          {guide.sections.map((s, i) => (
            <div key={i}>
              <h3 className="heading-s mb-2">{s.title}</h3>
              <ol className="space-y-2 pl-5 marker:text-ink-muted" style={{ listStyleType: "decimal" }}>
                {s.questions.map((q) => (
                  <li key={q.id} className="text-[15px] leading-relaxed">
                    {q.text}
                    {q.roomId && roomTitle(q.roomId) && (
                      <Badge className="ml-2 align-middle">
                        <DoorOpen className="size-3" aria-hidden /> {roomTitle(q.roomId)}
                      </Badge>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </Card>
      )}
      <GenerateGuideDialog clubId={clubId} editionId={editionId} open={generating} onClose={() => setGenerating(false)} hasGuide={count > 0} chapterCount={chapterCount} />
    </section>
  );
}

// --- Room view -------------------------------------------------------------------------------------

function PinnedQuestions({ questions }: { questions: DiscussionRoom["questions"] }) {
  if (!questions?.length) return null;
  return (
    <aside aria-label="Questions for this room" className="mb-3 rounded-card border border-accent/40 bg-accent-soft p-4">
      <p className="label mb-2 text-ink-muted">To talk about</p>
      <ol className="space-y-1.5 pl-5 text-sm leading-relaxed" style={{ listStyleType: "decimal" }}>
        {questions.map((q) => (
          <li key={q.id}>{q.text}</li>
        ))}
      </ol>
    </aside>
  );
}

function RoomView({ clubId, room, onBack, focusMessageId, canManage }: { clubId: string; room: DiscussionRoom; onBack: () => void; focusMessageId?: string | null; canManage?: boolean }) {
  const toast = useToast();
  const invalidate = useInvalidateRooms(clubId, room.edition.id);
  const remove = useMutation({
    mutationFn: () => api(clubApi(clubId, `/rooms/${encodeURIComponent(room.id)}`), { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast("Room removed.");
      onBack();
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const detail = useQuery({
    queryKey: roomKey(clubId, room.id),
    queryFn: () => api<DiscussionRoom>(clubApi(clubId, `/rooms/${encodeURIComponent(room.id)}`)),
    retry: false,
  });
  const live = detail.data ?? room;
  const locked = detail.isError && detail.error instanceof ApiRequestError && detail.error.status === 403 && detail.error.code === "room_locked";

  const header = (
    <div className="flex items-center gap-3 border-b border-line pb-3">
      <button type="button" onClick={onBack} className="rounded-control p-1 hover:bg-surface-2" aria-label="Back to all rooms">
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      <DoorOpen className="size-5 text-ink-muted" aria-hidden strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <h2 className="heading-s truncate">{live.title}</h2>
        <p className="truncate text-xs text-ink-muted">
          {ROOM_KIND_LABELS[live.kind]} · {gateLabel(live)} · {live.membersInside} inside
        </p>
      </div>
      {canManage && (
        <IconButton icon={Trash2} label="Remove room" disabled={remove.isPending} onClick={() => confirm(`Remove "${live.title}" and everything said in it?`) && remove.mutate()} />
      )}
    </div>
  );

  if (locked) {
    return (
      <div>
        {header}
        <EmptyState icon={Lock} title={gateLabel(room)}>
          {lockedCopy(room)}
        </EmptyState>
      </div>
    );
  }
  if (detail.isError) return <Alert tone="error">{errorMessage(detail.error)}</Alert>;

  return (
    <ChatConversation
      key={live.conversationId}
      clubId={clubId}
      conversationId={live.conversationId}
      header={header}
      pinned={<PinnedQuestions questions={live.questions} />}
      className="h-[calc(100dvh-10rem)] md:h-[calc(100dvh-8rem)]"
      emptyTitle="Nobody has spoken here yet"
      emptyBody="You are first. Say what struck you."
      focusMessageId={focusMessageId}
      renderLocked={() => (
        <EmptyState icon={Lock} title={gateLabel(room)}>
          {lockedCopy(room)}
        </EmptyState>
      )}
    />
  );
}

// --- Page ------------------------------------------------------------------------------------------

export function RoomsPage() {
  const club = useClub();
  const { editionId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: session } = useSession();
  const toast = useToast();
  const qc = useQueryClient();

  const rooms = useRooms(club.id, editionId);
  const progress = useProgress(club.id, editionId);
  const positions = useProgressAll(club.id, editionId);
  const guide = useGuide(club.id, editionId);
  const editionFallback = useQuery({
    queryKey: ["edition", editionId],
    queryFn: () => api<{ edition: EditionSummary }>(`/api/books/editions/${encodeURIComponent(editionId)}`),
    enabled: rooms.isSuccess && rooms.data.length === 0 && guide.isSuccess && !guide.data,
  });
  const edition: EditionSummary | null = rooms.data?.[0]?.edition ?? guide.data?.edition ?? editionFallback.data?.edition ?? null;
  useDocumentTitle(edition ? `Rooms · ${edition.title}` : "Discussion rooms");

  const [setup, setSetup] = useState(false);
  const [adding, setAdding] = useState(false);

  const saveProgress = useMutation({
    mutationFn: (input: ProgressInput) => api<ClubReadingProgress>(clubApi(club.id, `/books/${encodeURIComponent(editionId)}/progress?today=${todayIso()}`), { method: "PUT", body: input }),
    onSuccess: (p) => {
      qc.setQueryData(progressKey(club.id, editionId), p);
      void qc.invalidateQueries({ queryKey: roomsKey(club.id, editionId) });
      void qc.invalidateQueries({ queryKey: progressAllKey(club.id, editionId) });
      void qc.invalidateQueries({ queryKey: ["conversations", club.id] });
      toast(p.finished ? "Finished. The reflection room is open to you." : `Progress saved: ${progressLabel(p)}.`);
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });

  const list = useMemo(() => rooms.data ?? [], [rooms.data]);
  const grouped = useMemo(() => {
    const by = (k: RoomKind) => list.filter((r) => r.kind === k).sort((a, b) => a.position - b.position);
    return { chapter: by("chapter"), milestone: by("milestone"), reflection: by("reflection") };
  }, [list]);
  const chapterCount = grouped.chapter.length > 0 ? Math.max(...grouped.chapter.map((r) => r.gateValue ?? 0)) || grouped.chapter.length : null;
  const unlockedCount = list.filter((r) => r.unlocked).length;

  const openRoomId = params.get("room");
  const openRoom = openRoomId ? list.find((r) => r.id === openRoomId) : null;
  const setOpenRoom = (room: DiscussionRoom | null) => {
    const next = new URLSearchParams(params);
    if (room) next.set("room", room.id);
    else next.delete("room");
    next.delete("message");
    setParams(next);
  };

  // The server accepts room and guide writes from admins; members see read-only views.
  const admin = isAdmin(club);
  const canManage = admin;
  const me = session?.user.id;
  const others = (positions.data ?? []).filter((m) => m.id !== me);

  if (rooms.isError) return <Alert tone="error">{errorMessage(rooms.error)}</Alert>;

  if (openRoom) {
    return (
      <div className="space-y-4">
        <RoomView key={openRoom.id} clubId={club.id} room={openRoom} onBack={() => setOpenRoom(null)} focusMessageId={params.get("message")} canManage={admin} />
      </div>
    );
  }
  const headerActions: ReactNode = canManage ? (
    <>
      {list.length === 0 ? (
        <Button icon={DoorOpen} onClick={() => setSetup(true)}>
          Set up rooms
        </Button>
      ) : (
        <Button variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
          Add room
        </Button>
      )}
    </>
  ) : null;

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link to={clubPath(club.id, "messages")} className="hover:underline">
            Discussion rooms
          </Link>
        }
        title={edition?.title ?? "Discussion rooms"}
        description={
          edition ? (
            <span className="flex items-center gap-3">
              <BookCover url={edition.coverUrl} title={edition.title} size="xs" />
              <span>
                {authorsLine(edition.authors)}
                {list.length > 0 && ` · ${unlockedCount} of ${list.length} rooms open to you`}
              </span>
            </span>
          ) : (
            "Spoiler-safe rooms that open as you read."
          )
        }
        actions={headerActions}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          {rooms.isPending && <Spinner />}
          {rooms.isSuccess && list.length === 0 && (
            <EmptyState
              icon={DoorOpen}
              title="No rooms yet"
              action={
                admin ? (
                  <Button icon={DoorOpen} onClick={() => setSetup(true)}>
                    Set up rooms
                  </Button>
                ) : undefined
              }
            >
              {admin ? "Rooms keep the conversation ahead of spoilers: each one opens as readers reach it." : "Rooms keep the conversation ahead of spoilers. An admin can set them up for this book."}
            </EmptyState>
          )}
          {(["chapter", "milestone", "reflection"] as RoomKind[]).map((kind) =>
            grouped[kind].length === 0 ? null : (
              <section key={kind} aria-labelledby={`rooms-${kind}`}>
                <SectionTitle>
                  <span id={`rooms-${kind}`}>{kind === "chapter" ? "Chapters" : kind === "milestone" ? "Milestones" : "Reflection"}</span>
                </SectionTitle>
                <ul className={cx("grid gap-3", kind === "chapter" ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2")}>
                  {grouped[kind].map((r) => (
                    <RoomCard key={r.id} room={r} onOpen={setOpenRoom} />
                  ))}
                </ul>
              </section>
            ),
          )}
          <GuideSectionView clubId={club.id} editionId={editionId} guide={guide.data ?? null} rooms={list} chapterCount={chapterCount} canEdit={admin} />
        </div>

        <div className="space-y-4 lg:order-first lg:col-start-2 lg:row-start-1">
          <Card>
            <h2 className="heading-s mb-3">Your progress</h2>
            {progress.isPending ? <Spinner /> : <ProgressControl progress={progress.data ?? null} pageCount={edition?.pageCount} onSave={(input) => saveProgress.mutate(input)} saving={saveProgress.isPending} />}
            <p className="mt-3 text-xs text-ink-muted">Only your position is shared, never your notes. Rooms open as you move forward.</p>
          </Card>
          <Card>
            <h2 className="heading-s mb-3">The club</h2>
            {positions.isPending ? <Spinner /> : others.length === 0 ? <p className="text-sm text-ink-muted">Nobody else has set a position yet.</p> : <MemberPositions members={others} mine={progress.data} />}
          </Card>
        </div>
      </div>

      <SetupRoomsDialog clubId={club.id} editionId={editionId} open={setup} onClose={() => setSetup(false)} />
      <AddRoomDialog clubId={club.id} editionId={editionId} open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
