import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, EyeOff, Lock, Pencil, Share2, ThumbsUp, Lightbulb, Laugh, Handshake, Trash2, Users } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { Link } from "react-router";
import type { z } from "zod";
import { SENTIMENTS, SENTIMENT_LABELS, type ReviewReaction, type ShareResourceType, type Visibility } from "@shared/constants";
import { quoteUpdateSchema, reviewUpdateSchema, type ShareCreateInput } from "@shared/schemas";
import type { MemberSummary, Quote, Review, ShareLinkCreated } from "@shared/types";
import { api, errorMessage } from "@/lib/api";
import { clubPath, useCurrentClubId } from "@/lib/club";
import { formatDate } from "@/lib/format";
import { Avatar } from "./Avatar";
import { BookRow } from "./books";
import { Turnstile, type TurnstileHandle } from "./Turnstile";
import { Alert, Badge, Button, Card, Checkbox, cx, Field, IconButton, Input, Select, Textarea, type BadgeTone } from "./ui";
import { Dialog } from "./ui/Dialog";
import { useToast } from "./ui/Toast";

/** A member's name linking to their profile inside the current club (plain text when no club is in scope). */
export function MemberLink({ member, className, children }: { member: Pick<MemberSummary, "username" | "displayName">; className?: string; children?: ReactNode }) {
  const clubId = useCurrentClubId();
  const content = children ?? member.displayName;
  if (!clubId) return <span className={className}>{content}</span>;
  return (
    <Link to={clubPath(clubId, `members/${encodeURIComponent(member.username)}`)} className={cx("hover:underline", className)}>
      {content}
    </Link>
  );
}

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  return visibility === "private" ? (
    <Badge>
      <Lock className="size-3" aria-hidden /> Private
    </Badge>
  ) : (
    <Badge tone="info">
      <Users className="size-3" aria-hidden /> Clubs
    </Badge>
  );
}

export function VisibilityField({ field, error }: { field: UseFormRegisterReturn; error?: string }) {
  return (
    <Field label="Who can see this" error={error}>
      {(id) => (
        <Select id={id} {...field}>
          <option value="club">Members of my clubs</option>
          <option value="private">Only me</option>
        </Select>
      )}
    </Field>
  );
}

const reactionIcons: Record<ReviewReaction, typeof ThumbsUp> = { like: ThumbsUp, insightful: Lightbulb, funny: Laugh, agree: Handshake };
const reactionLabels: Record<ReviewReaction, string> = { like: "Like", insightful: "Insightful", funny: "Funny", agree: "Agree" };

export const sentimentTone = (s: Review["sentiment"]): BadgeTone => (s === "loved" || s === "liked" ? "success" : s === "mixed" ? "brass" : "error");

// --- Reviews ------------------------------------------------------------------------------

export function ReviewForm({ review, editionId, onDone }: { review?: Review; editionId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm<z.input<typeof reviewUpdateSchema>>({
    resolver: zodResolver(reviewUpdateSchema),
    defaultValues: review
      ? { body: review.body, sentiment: review.sentiment, visibility: review.visibility, containsSpoilers: review.containsSpoilers }
      : { body: "", sentiment: "liked", visibility: "club", containsSpoilers: false },
  });
  const save = useMutation({
    mutationFn: (values: z.input<typeof reviewUpdateSchema>) =>
      review ? api<Review>(`/api/reviews/${review.id}`, { method: "PUT", body: values }) : api<Review>("/api/reviews", { body: { ...values, editionId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reviews"] });
      toast(review ? "Review updated." : "Review saved.");
      onDone();
    },
  });
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">How did it land</legend>
        <div className="flex flex-wrap gap-2">
          {SENTIMENTS.map((s) => (
            <label key={s} className="cursor-pointer">
              <input type="radio" value={s} className="peer sr-only" {...form.register("sentiment")} />
              <span className="inline-flex rounded-control border border-line px-3 py-1.5 text-sm peer-checked:border-ink peer-checked:bg-primary peer-checked:font-semibold peer-checked:text-on-primary peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--color-focus)]">
                {SENTIMENT_LABELS[s]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Your review" error={form.formState.errors.body?.message}>
        {(id) => <Textarea id={id} rows={7} {...form.register("body")} />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <VisibilityField field={form.register("visibility")} />
        <div className="flex items-end pb-3">
          <Checkbox label="Contains spoilers" {...form.register("containsSpoilers")} />
        </div>
      </div>
      {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      <Button type="submit" loading={save.isPending}>
        Save review
      </Button>
    </form>
  );
}

export function ReviewCard({ review, showBook = false }: { review: Review; showBook?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [reveal, setReveal] = useState(false);
  const react = useMutation({
    mutationFn: ({ reaction, mine }: { reaction: ReviewReaction; mine: boolean }) =>
      mine ? api<Review>(`/api/reviews/${review.id}/reactions/${reaction}`, { method: "DELETE" }) : api<Review>(`/api/reviews/${review.id}/reactions`, { body: { reaction } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["reviews"] }),
    onError: (err) => toast(errorMessage(err), "error"),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/reviews/${review.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reviews"] });
      toast("Review deleted.");
    },
  });
  const hidden = review.containsSpoilers && !reveal && !review.isOwn;
  return (
    <Card as="article" className="space-y-3">
      <div id={`review-${review.id}`} className="flex items-start gap-3">
        <Avatar member={review.author} />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <MemberLink member={review.author} className="font-medium" /> <span className="text-ink-muted">· {formatDate(review.createdAt)}</span>
            {review.updatedAt !== review.createdAt && <span className="text-xs text-ink-muted"> (edited)</span>}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge tone={sentimentTone(review.sentiment)}>{SENTIMENT_LABELS[review.sentiment]}</Badge>
            {review.containsSpoilers && <Badge tone="brass">Spoilers</Badge>}
            {review.isOwn && <VisibilityBadge visibility={review.visibility} />}
          </div>
        </div>
        {review.isOwn && (
          <div className="flex">
            <IconButton icon={Share2} label="Share publicly" onClick={() => setSharing(true)} />
            <IconButton icon={Pencil} label="Edit review" onClick={() => setEditing(true)} />
            <IconButton icon={Trash2} label="Delete review" onClick={() => confirm("Delete this review?") && remove.mutate()} />
          </div>
        )}
      </div>
      {showBook && <BookRow edition={review.edition} />}
      {hidden ? (
        <Button variant="secondary" size="sm" icon={Eye} onClick={() => setReveal(true)}>
          Show review with spoilers
        </Button>
      ) : review.body ? (
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{review.body}</p>
      ) : null}
      {review.containsSpoilers && reveal && !review.isOwn && (
        <Button variant="ghost" size="sm" icon={EyeOff} onClick={() => setReveal(false)}>
          Hide spoilers
        </Button>
      )}
      <div className="flex flex-wrap gap-1.5" aria-label="Reactions">
        {review.reactions.map((r) => {
          const Icon = reactionIcons[r.reaction];
          return (
            <button
              key={r.reaction}
              type="button"
              aria-pressed={r.mine}
              disabled={react.isPending}
              onClick={() => react.mutate({ reaction: r.reaction, mine: r.mine })}
              className={cx(
                "inline-flex items-center gap-1 rounded-chip border px-2.5 py-1 text-xs font-medium",
                r.mine ? "border-ink bg-primary text-on-primary" : "border-line text-ink-muted hover:bg-surface-2",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {reactionLabels[r.reaction]}
              {r.count > 0 && <span className="font-semibold">{r.count}</span>}
            </button>
          );
        })}
      </div>
      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit review" wide>
        <ReviewForm review={review} editionId={review.edition.id} onDone={() => setEditing(false)} />
      </Dialog>
      <ShareDialog open={sharing} onClose={() => setSharing(false)} input={{ resourceType: "review", resourceId: review.id }} label="this review" />
    </Card>
  );
}

// --- Quotes ------------------------------------------------------------------------------------

export function QuoteForm({ quote, editionId, onDone }: { quote?: Quote; editionId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm<z.input<typeof quoteUpdateSchema>>({
    resolver: zodResolver(quoteUpdateSchema),
    defaultValues: quote ? { text: quote.text, location: quote.location, note: quote.note, visibility: quote.visibility } : { text: "", location: "", note: "", visibility: "club" },
  });
  const save = useMutation({
    mutationFn: (values: z.input<typeof quoteUpdateSchema>) =>
      quote ? api<Quote>(`/api/quotes/${quote.id}`, { method: "PUT", body: values }) : api<Quote>("/api/quotes", { body: { ...values, editionId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      toast(quote ? "Quote updated." : "Quote saved.");
      onDone();
    },
  });
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
      <Field label="Quotation" error={form.formState.errors.text?.message}>
        {(id) => <Textarea id={id} rows={5} className="font-display text-lg" {...form.register("text")} />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Page or location" error={form.formState.errors.location?.message}>
          {(id) => <Input id={id} placeholder="p. 42" {...form.register("location")} />}
        </Field>
        <VisibilityField field={form.register("visibility")} />
      </div>
      <Field label="Private note" hint="Only you can see this note." error={form.formState.errors.note?.message}>
        {(id, d) => <Textarea id={id} aria-describedby={d} rows={2} {...form.register("note")} />}
      </Field>
      {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
      <Button type="submit" loading={save.isPending}>
        Save quote
      </Button>
    </form>
  );
}

export function QuoteCard({ quote, showBook = true }: { quote: Quote; showBook?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const remove = useMutation({
    mutationFn: () => api(`/api/quotes/${quote.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quotes"] });
      toast("Quote deleted.");
    },
  });
  return (
    <Card as="article" className="space-y-3">
      <blockquote className="border-l-2 border-accent pl-4 font-display text-xl leading-relaxed whitespace-pre-wrap">{quote.text}</blockquote>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <Avatar member={quote.author} size="xs" />
        <MemberLink member={quote.author} />
        {quote.location && <span>· {quote.location}</span>}
        <span>· {formatDate(quote.createdAt)}</span>
        {quote.isOwn && <VisibilityBadge visibility={quote.visibility} />}
        {quote.isOwn && (
          <span className="ml-auto flex">
            <IconButton icon={Share2} label="Share publicly" onClick={() => setSharing(true)} />
            <IconButton icon={Pencil} label="Edit quote" onClick={() => setEditing(true)} />
            <IconButton icon={Trash2} label="Delete quote" onClick={() => confirm("Delete this quote?") && remove.mutate()} />
          </span>
        )}
      </div>
      {quote.note && <p className="rounded-control bg-surface-2 px-3 py-2 text-sm text-ink-muted">Note: {quote.note}</p>}
      {showBook && <BookRow edition={quote.edition} />}
      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit quote">
        <QuoteForm quote={quote} editionId={quote.edition.id} onDone={() => setEditing(false)} />
      </Dialog>
      <ShareDialog open={sharing} onClose={() => setSharing(false)} input={{ resourceType: "quote", resourceId: quote.id }} label="this quote" />
    </Card>
  );
}

// --- Sharing ----------------------------------------------------------------------------------------

export function ShareDialog({
  open,
  onClose,
  input,
  label,
}: {
  open: boolean;
  onClose: () => void;
  input: ShareCreateInput & { resourceType: ShareResourceType };
  label: string;
}) {
  const qc = useQueryClient();
  const captchaRef = useRef<TurnstileHandle>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [expires, setExpires] = useState("");
  const [created, setCreated] = useState<ShareLinkCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      api<ShareLinkCreated>("/api/shares", {
        body: { ...input, expiresInDays: expires ? Number(expires) : null },
        headers: { "x-turnstile-token": captcha ?? "" },
      }),
    onSuccess: (link) => {
      setCreated(link);
      void qc.invalidateQueries({ queryKey: ["shares"] });
    },
    onSettled: () => captchaRef.current?.reset(),
  });
  const close = () => {
    setCreated(null);
    setCopied(false);
    create.reset();
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title="Share publicly">
      {created ? (
        <div className="space-y-3">
          <Alert tone="success">Anyone with this link can view {label}. Copy it now; for safety it is shown only once.</Alert>
          <div className="flex gap-2">
            <Input readOnly value={created.url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
            <Button
              icon={Copy}
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard?.writeText(created.url);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-ink-muted">You can turn this link off at any time in Settings, under Share links.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            Create a public link to {label}. People who open it see only that content and your display name, never your email, private notes or any messages.
          </p>
          <Field label="Link expires">
            {(id) => (
              <Select id={id} value={expires} onChange={(e) => setExpires(e.target.value)}>
                <option value="">Never (until you turn it off)</option>
                <option value="1">After 1 day</option>
                <option value="7">After 7 days</option>
                <option value="30">After 30 days</option>
              </Select>
            )}
          </Field>
          <Turnstile ref={captchaRef} onToken={setCaptcha} action="share" />
          {create.isError && <Alert tone="error">{errorMessage(create.error)}</Alert>}
          <Button icon={Share2} disabled={!captcha} loading={create.isPending} onClick={() => create.mutate()}>
            Create link
          </Button>
        </div>
      )}
    </Dialog>
  );
}
