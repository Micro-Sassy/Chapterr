import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, LogOut, Settings } from "lucide-react";
import { Link, useNavigate } from "react-router";
import type { AppNotification } from "@shared/types";
import { clubNav, PERSONAL_NAV, type NavItem } from "@/components/AppShell";
import { Avatar } from "@/components/Avatar";
import { InstallAppButton } from "@/components/InstallApp";
import { Badge, Button, cx, EmptyState, LinkButton, PageHeader, Spinner, TextLink } from "@/components/ui";
import { api } from "@/lib/api";
import { useSignOut } from "@/lib/auth";
import { useCurrentClub } from "@/lib/club";
import { relativeTime } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { LoadMore, usePaged } from "./clubs/Collections";

export function NotificationsPage() {
  useDocumentTitle("Notifications");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = usePaged<AppNotification>(["notifications", "list"], "/api/notifications");
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const readAll = useMutation({
    mutationFn: () => api("/api/notifications/read-all", { body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const open = async (n: AppNotification) => {
    if (!n.readAt) {
      await api(`/api/notifications/${n.id}/read`, { body: {} }).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    }
    if (n.link?.startsWith("/")) navigate(n.link);
  };
  return (
    <div>
      <PageHeader
        title="Notifications"
        actions={
          <Button variant="secondary" icon={CheckCheck} loading={readAll.isPending} onClick={() => readAll.mutate()}>
            Mark all read
          </Button>
        }
      />
      {q.isPending && <Spinner />}
      {q.isSuccess && items.length === 0 && (
        <EmptyState icon={Bell} title="You're all caught up">
          Choose what you are notified about in <TextLink to="/settings?tab=notifications">Settings</TextLink>.
        </EmptyState>
      )}
      <ul className="space-y-2">
        {items.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => void open(n)}
              className={cx("flex w-full items-start gap-3 rounded-card border border-line p-3 text-left hover:bg-surface-2", n.readAt ? "bg-surface" : "bg-surface-2")}
            >
              <Avatar member={n.actor} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className={cx("text-sm", !n.readAt && "font-semibold")}>{n.title}</span>
                  {n.clubName && <Badge>{n.clubName}</Badge>}
                </span>
                {n.body && <span className="block truncate text-sm text-ink-muted">{n.body}</span>}
                <span className="block text-xs text-ink-muted">{relativeTime(n.createdAt)}</span>
              </span>
              {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
            </button>
          </li>
        ))}
      </ul>
      <LoadMore q={q} />
    </div>
  );
}

function MoreLink({ item }: { item: NavItem }) {
  return (
    <li>
      <Link to={item.to} className="flex items-center gap-3 rounded-card border border-line bg-surface p-4 hover:bg-surface-2">
        <item.icon className="size-5 text-ink-muted" aria-hidden strokeWidth={1.75} />
        <span className="font-medium">{item.label}</span>
      </Link>
    </li>
  );
}

/** Mobile "More" page: everything the bottom bar leaves out. */
export function MorePage() {
  useDocumentTitle("More");
  const club = useCurrentClub();
  const signOut = useSignOut();
  const navigate = useNavigate();
  return (
    <div className="space-y-8">
      <PageHeader title="More" />
      {club && (
        <section>
          <h2 className="label mb-2 text-ink-muted">{club.name}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {clubNav(club.id).map((item) => (
              <MoreLink key={item.to} item={item} />
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2 className="label mb-2 text-ink-muted">You</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {PERSONAL_NAV.map((item) => (
            <MoreLink key={item.to} item={item} />
          ))}
          <MoreLink item={{ to: "/settings", label: "Account settings", icon: Settings }} />
          <MoreLink item={{ to: "/notifications", label: "Notifications", icon: Bell }} />
        </ul>
      </section>
      <div className="flex flex-col gap-2 sm:flex-row">
        <InstallAppButton className="w-full sm:w-auto" label="Install app" />
        <Button
          variant="ghost"
          icon={LogOut}
          className="w-full sm:w-auto"
          onClick={async () => {
            await signOut();
            navigate("/sign-in");
          }}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  useDocumentTitle("Not found");
  return (
    <EmptyState title="Page not found" action={<LinkButton to="/">Go home</LinkButton>}>
      That page does not exist or you do not have access to it.
    </EmptyState>
  );
}
