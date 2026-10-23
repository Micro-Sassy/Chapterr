import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { Club, InvitePreview, InvitePreviewExtras, JoinPending } from "@shared/types";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { Alert, Button, Field, LinkButton, Spinner, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { clubPath, rememberPendingJoin } from "@/lib/club";
import { AuthLayout } from "../auth/AuthLayout";

/** The preview carries the join policy and screening questions when the club screens newcomers. */
type Preview = InvitePreview & Partial<InvitePreviewExtras>;
type JoinResult = Club | JoinPending;
const isPending = (r: JoinResult): r is JoinPending => "pending" in r && r.pending === true;

/**
 * Invite landing page. Works signed out (a public preview with no member list);
 * sign-in and registration return here via ?next=. Clubs that screen newcomers
 * show their questions here and the join becomes a request.
 */
export function JoinPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: session, isPending: sessionPending } = useSession();
  const captchaRef = useRef<TurnstileHandle>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<JoinPending | null>(null);
  const preview = useQuery({
    queryKey: ["invite", code],
    queryFn: () => api<Preview>(`/api/invites/${encodeURIComponent(code)}`),
    retry: false,
  });
  const p = preview.data;
  const screening = p?.joinPolicy === "approval";
  const questions = p?.screeningQuestions ?? [];
  const missing = screening ? questions.filter((q) => q.required && !(answers[q.id] ?? "").trim()) : [];

  const join = useMutation({
    mutationFn: () =>
      api<JoinResult>("/api/clubs/join", {
        body: screening ? { code, answers: questions.map((q) => ({ questionId: q.id, answer: (answers[q.id] ?? "").trim() })), message: message.trim() || null } : { code },
        headers: { "x-turnstile-token": captcha ?? "" },
      }),
    onSuccess: async (result) => {
      void qc.invalidateQueries({ queryKey: ["join-requests", "mine"] });
      if (isPending(result)) {
        setSent(result);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["home"] });
      toast(`Welcome to ${result.name}.`);
      navigate(clubPath(result.id), { replace: true });
    },
    onError: () => captchaRef.current?.reset(),
  });

  // Remember the code while signed out so the member lands back here after verifying.
  useEffect(() => {
    if (!sessionPending && !session && code) rememberPendingJoin(code);
  }, [session, sessionPending, code]);

  const next = encodeURIComponent(`/join/${code}`);
  const invalid = preview.isError && preview.error instanceof ApiRequestError && (preview.error.status === 404 || preview.error.status === 410);

  if (sent) {
    return (
      <AuthLayout title="Request sent" subtitle={`An admin of ${sent.clubName || p?.club.name || "the club"} will look at it soon.`}>
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-control border border-line bg-ground p-4">
            <Clock className="mt-0.5 size-5 shrink-0 text-ink-muted" aria-hidden strokeWidth={1.75} />
            <p className="text-sm">We will let you know here and by email once they decide. Your answers are visible to the club's admins only.</p>
          </div>
          <LinkButton to="/" className="w-full">
            Go home
          </LinkButton>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={p ? `Join ${p.club.name}` : invalid ? "This invite isn't valid" : "You're invited"} subtitle={p?.invitedBy ? `${p.invitedBy} invited you to read together.` : undefined}>
      {preview.isPending && <Spinner />}
      {preview.isError && (
        <Alert tone="error">{invalid ? "This invite link has been turned off or never existed. Ask a club admin for a new one." : errorMessage(preview.error)}</Alert>
      )}
      {p && (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-control border border-line bg-ground p-4">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-primary text-on-primary">
              <Users className="size-5" aria-hidden strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="heading-s">{p.club.name}</p>
              {p.club.description && <p className="mt-1 text-sm text-ink-muted">{p.club.description}</p>}
              <p className="mt-1 text-sm text-ink-muted">
                {p.club.memberCount} {p.club.memberCount === 1 ? "member" : "members"}
                {screening ? " · admins approve new members" : ""}
              </p>
            </div>
          </div>
          {p.expired ? (
            <Alert tone="warning">This invite has expired or used up its seats. Ask a club admin for a new link.</Alert>
          ) : sessionPending ? (
            <Spinner />
          ) : !session ? (
            <div className="space-y-3">
              <p className="text-sm text-ink-muted">Sign in or create a free account to {screening ? "ask to join" : "join"}. You'll come straight back here.</p>
              <LinkButton to={`/sign-in?next=${next}`} className="w-full">
                Sign in
              </LinkButton>
              <LinkButton to={`/register?next=${next}`} variant="secondary" className="w-full">
                Create account
              </LinkButton>
            </div>
          ) : p.alreadyMember ? (
            <div className="space-y-3">
              <Alert tone="success">You're already a member of this club.</Alert>
              <LinkButton to={clubPath(p.club.id)} className="w-full">
                Open club
              </LinkButton>
            </div>
          ) : (
            <form
              className="space-y-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (missing.length === 0) join.mutate();
              }}
            >
              {screening && (
                <div className="space-y-3">
                  <p className="text-sm text-ink-muted">{questions.length > 0 ? "A few questions from the club first. Admins see your answers; other members do not." : "Add a line about yourself if you like; an admin will approve your request."}</p>
                  {questions.map((q, i) => (
                    <Field key={q.id} label={`${q.label}${q.required ? "" : " (optional)"}`} error={join.isError && q.required && !(answers[q.id] ?? "").trim() ? "Please answer this one." : undefined}>
                      {(id) => (
                        <Textarea
                          id={id}
                          rows={2}
                          maxLength={500}
                          required={q.required}
                          aria-required={q.required}
                          autoFocus={i === 0}
                          value={answers[q.id] ?? ""}
                          onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                        />
                      )}
                    </Field>
                  ))}
                  <Field label="Message to the admins (optional)">
                    {(id) => <Textarea id={id} rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />}
                  </Field>
                </div>
              )}
              <Turnstile ref={captchaRef} onToken={setCaptcha} action="join-club" />
              {join.isError && <Alert tone="error">{errorMessage(join.error)}</Alert>}
              <Button type="submit" className="w-full" disabled={!captcha || missing.length > 0} loading={join.isPending}>
                {screening ? "Request to join" : "Join club"}
              </Button>
              {missing.length > 0 && <p className="text-center text-xs text-ink-muted">Answer the {missing.length === 1 ? "required question" : `${missing.length} required questions`} to continue.</p>}
              <p className="text-center text-xs text-ink-muted">Members of the club will see your display name and anything you mark visible to your clubs.</p>
            </form>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
