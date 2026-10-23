import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { Club, InvitePreview } from "@shared/types";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { Alert, Button, LinkButton, Spinner } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { clubPath, rememberPendingJoin } from "@/lib/club";
import { AuthLayout } from "../auth/AuthLayout";

/**
 * Invite landing page. Works signed out (a public preview with no member list);
 * sign-in and registration return here via ?next=.
 */
export function JoinPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: session, isPending: sessionPending } = useSession();
  const captchaRef = useRef<TurnstileHandle>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ["invite", code],
    queryFn: () => api<InvitePreview>(`/api/invites/${encodeURIComponent(code)}`),
    retry: false,
  });
  const join = useMutation({
    mutationFn: () => api<Club>("/api/clubs/join", { body: { code }, headers: { "x-turnstile-token": captcha ?? "" } }),
    onSuccess: async (club) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["home"] });
      toast(`Welcome to ${club.name}.`);
      navigate(clubPath(club.id), { replace: true });
    },
    onError: () => captchaRef.current?.reset(),
  });

  // Remember the code while signed out so the member lands back here after verifying.
  useEffect(() => {
    if (!sessionPending && !session && code) rememberPendingJoin(code);
  }, [session, sessionPending, code]);

  const next = encodeURIComponent(`/join/${code}`);
  const p = preview.data;
  const invalid = preview.isError && preview.error instanceof ApiRequestError && (preview.error.status === 404 || preview.error.status === 410);

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
              </p>
            </div>
          </div>
          {p.expired ? (
            <Alert tone="warning">This invite has expired or used up its seats. Ask a club admin for a new link.</Alert>
          ) : sessionPending ? (
            <Spinner />
          ) : !session ? (
            <div className="space-y-3">
              <p className="text-sm text-ink-muted">Sign in or create a free account to join. You'll come straight back here.</p>
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
            <div className="space-y-3">
              <Turnstile ref={captchaRef} onToken={setCaptcha} action="join-club" />
              {join.isError && <Alert tone="error">{errorMessage(join.error)}</Alert>}
              <Button className="w-full" disabled={!captcha} loading={join.isPending} onClick={() => join.mutate()}>
                Join club
              </Button>
              <p className="text-center text-xs text-ink-muted">Members of the club will see your display name and anything you mark visible to your clubs.</p>
            </div>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
