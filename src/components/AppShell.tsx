import clsx from "clsx";
import {
  Bell,
  CalendarDays,
  CalendarRange,
  ChevronsUpDown,
  Flame,
  FolderOpen,
  Gift,
  Home,
  KeyRound,
  LayoutDashboard,
  Library,
  ListOrdered,
  LogOut,
  Menu as MenuIcon,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Quote,
  Search,
  Settings,
  Sparkles,
  Star,
  Target,
  Trophy,
  type LucideIcon,
  Users,
  UsersRound,
  Vote,
  WifiOff,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { CLUB_ROLE_LABELS } from "@shared/constants";
import type { ClubSummary, Conversation } from "@shared/types";
import { api } from "@/lib/api";
import { useSession, useSignOut } from "@/lib/auth";
import { clubPath, useCurrentClub, useCurrentClubId, useMe } from "@/lib/club";
import { useOnline } from "@/lib/hooks";
import { Avatar } from "./Avatar";
import { InstallAppButton, InstallBanner } from "./InstallApp";
import { JoinCodeDialog } from "./JoinCodeDialog";
import { Logo } from "./Logo";
import { Badge } from "./ui";
import { Menu, MenuItem, MenuLabel, MenuLink, MenuSeparator } from "./ui/Menu";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export const PERSONAL_NAV: NavItem[] = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/library", label: "My library", icon: Library },
  { to: "/books/add", label: "Find books", icon: Search },
  { to: "/goals", label: "Goals", icon: Target },
  { to: "/reading", label: "Reading log", icon: Flame },
];

export function clubNav(clubId: string): NavItem[] {
  return [
    { to: clubPath(clubId), label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: clubPath(clubId, "list"), label: "Reading list", icon: ListOrdered },
    { to: clubPath(clubId, "meetings"), label: "Meetings", icon: CalendarDays },
    { to: clubPath(clubId, "calendar"), label: "Calendar", icon: CalendarRange },
    { to: clubPath(clubId, "polls"), label: "Polls", icon: Vote },
    { to: clubPath(clubId, "activities"), label: "Activities", icon: Sparkles },
    { to: clubPath(clubId, "reviews"), label: "Reviews", icon: Star },
    { to: clubPath(clubId, "quotes"), label: "Quotes", icon: Quote },
    { to: clubPath(clubId, "recommend"), label: "Recommendations", icon: Sparkles },
    { to: clubPath(clubId, "messages"), label: "Messages", icon: MessageCircle },
    { to: clubPath(clubId, "files"), label: "Files", icon: FolderOpen },
    { to: clubPath(clubId, "challenges"), label: "Challenges", icon: Trophy },
    { to: clubPath(clubId, "wrapped"), label: "Wrapped", icon: Gift },
    { to: clubPath(clubId, "members"), label: "Members", icon: Users },
    { to: clubPath(clubId, "settings"), label: "Settings", icon: Settings },
  ];
}

function useUnread(clubId: string | null) {
  const messages = useQuery({
    queryKey: ["conversations", clubId],
    queryFn: () => api<Conversation[]>(`/api/clubs/${clubId}/conversations`),
    enabled: !!clubId,
    refetchInterval: 120_000,
  });
  const notifications = useQuery({
    queryKey: ["notifications", "count"],
    queryFn: () => api<{ count: number }>("/api/notifications/unread-count"),
    refetchInterval: 120_000,
  });
  return {
    messages: messages.data?.reduce((n, c) => n + c.unreadCount, 0) ?? 0,
    notifications: notifications.data?.count ?? 0,
  };
}

function CountBadge({ count, label }: { count: number; label: string }) {
  if (!count) return null;
  return (
    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-chip bg-primary px-1.5 text-[11px] font-semibold text-on-primary" aria-label={`${count} ${label}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

const COLLAPSE_KEY = "chapterr:sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Desktop sidebar can shrink to an icon rail; the choice is remembered on this device. */
function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () =>
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable: remember for this visit only */
      }
      return next;
    });
  return [collapsed, toggle] as const;
}

export function RoleChip({ role }: { role: ClubSummary["role"] }) {
  return <Badge tone={role === "owner" ? "brass" : role === "admin" ? "forest" : "neutral"}>{CLUB_ROLE_LABELS[role]}</Badge>;
}

/** Club switcher: current club name + chevron; the menu lists every club with a role chip. */
export function ClubSwitcher({ collapsed, onJoin }: { collapsed: boolean; onJoin: () => void }) {
  const me = useMe();
  const current = useCurrentClub();
  const clubs = me.data?.clubs ?? [];
  return (
    <Menu
      label="Your clubs"
      menuClassName="w-72"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={collapsed ? (current ? `Switch club: ${current.name}` : "Switch club") : undefined}
          title={collapsed ? (current?.name ?? "Clubs") : undefined}
          className={clsx(
            "flex w-full items-center gap-2.5 rounded-control border border-line bg-surface text-left hover:bg-surface-2",
            collapsed ? "justify-center p-2" : "px-3 py-2.5",
          )}
        >
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-primary text-on-primary">
            <UsersRound className="size-4" aria-hidden strokeWidth={1.75} />
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="label block text-ink-muted">Club</span>
                <span className="block truncate text-sm font-semibold">{current?.name ?? (me.isPending ? "…" : "No club yet")}</span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-ink-muted" aria-hidden />
            </>
          )}
        </button>
      )}
    >
      {clubs.length > 0 && <MenuLabel>Your clubs</MenuLabel>}
      {clubs.map((c) => (
        <MenuLink key={c.id} to={clubPath(c.id)} active={c.id === current?.id} trailing={<RoleChip role={c.role} />}>
          {c.name}
        </MenuLink>
      ))}
      {clubs.length > 0 && <MenuSeparator />}
      <MenuLink to="/clubs/new" icon={Plus}>
        Create a club
      </MenuLink>
      <MenuItem icon={KeyRound} onClick={onJoin}>
        Join with a code
      </MenuItem>
    </Menu>
  );
}

function SidebarLink({ item, collapsed, trailing }: { item: NavItem; collapsed: boolean; trailing?: ReactNode }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        clsx(
          "relative flex items-center gap-3 rounded-control py-2 text-[15px] transition-colors",
          collapsed ? "justify-center px-0" : "px-3",
          isActive ? "bg-primary font-semibold text-on-primary" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
        )
      }
    >
      <item.icon className="size-[18px] shrink-0" aria-hidden strokeWidth={1.75} />
      {!collapsed && item.label}
      {trailing}
    </NavLink>
  );
}

export function AppShell() {
  const online = useOnline();
  const { data: session } = useSession();
  const me = useMe();
  const clubId = useCurrentClubId();
  const unread = useUnread(clubId);
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [collapsed, toggleSidebar] = useSidebarCollapsed();
  const [joining, setJoining] = useState(false);

  const member = me.data ?? (session ? { displayName: session.user.name, avatarUrl: session.user.image } : null);
  const club = clubId ? clubNav(clubId) : [];
  const clubRoot = clubId ? clubPath(clubId) : "/clubs/new";
  const clubMessages = clubId ? clubPath(clubId, "messages") : "/clubs/new";

  const mobile: NavItem[] = [
    { to: "/", label: "Home", icon: Home, end: true },
    { to: "/library", label: "Library", icon: Library },
    { to: clubRoot, label: "Club", icon: UsersRound, end: true },
    { to: clubMessages, label: "Messages", icon: MessageCircle },
    { to: "/more", label: "More", icon: MenuIcon },
  ];

  const messageDot = (cls: string) => unread.messages > 0 && <span className={clsx("size-2 rounded-full bg-accent", cls)} aria-hidden />;

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* Desktop / tablet sidebar */}
      <aside
        id="sidebar"
        className={clsx("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 md:flex", collapsed ? "w-[4.5rem]" : "w-[17rem]")}
      >
        <NavLink to="/" aria-label="Home" className={clsx("flex items-center", collapsed ? "justify-center px-2 pb-3 pt-5" : "px-5 pb-4 pt-6")}>
          {collapsed ? <Logo variant="mark" className="h-8" /> : <Logo variant="horizontal" className="h-8" />}
        </NavLink>
        <div className={clsx("pb-3", collapsed ? "px-2" : "px-3")}>
          <ClubSwitcher collapsed={collapsed} onJoin={() => setJoining(true)} />
        </div>
        <nav aria-label="Main" className={clsx("flex-1 overflow-y-auto overflow-x-hidden", collapsed ? "px-2" : "px-3")}>
          {club.length > 0 && (
            <ul className="space-y-0.5">
              {club.map((item) => (
                <li key={item.to}>
                  <SidebarLink
                    item={item}
                    collapsed={collapsed}
                    trailing={
                      item.label === "Messages"
                        ? collapsed
                          ? messageDot("absolute right-2 top-1.5")
                          : unread.messages > 0 && <CountBadge count={unread.messages} label="unread messages" />
                        : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          {!collapsed && <p className="label mb-1 mt-5 px-3 text-ink-muted">You</p>}
          {collapsed && <div className="my-3 border-t border-line" aria-hidden />}
          <ul className="space-y-0.5">
            {PERSONAL_NAV.map((item) => (
              <li key={item.to}>
                <SidebarLink item={item} collapsed={collapsed} />
              </li>
            ))}
          </ul>
        </nav>
        <div className={clsx("pb-3", collapsed ? "px-2" : "px-3")}>
          <InstallAppButton variant="ghost" iconOnly={collapsed} className={clsx("w-full text-ink-muted", !collapsed && "justify-start")} />
        </div>
        <div className={clsx("border-t border-line", collapsed ? "p-2" : "p-3")}>
          <div className={clsx("flex items-center gap-2 py-2", collapsed ? "flex-col px-0" : "px-2")}>
            <NavLink to="/settings" aria-label="Account settings" className="rounded-full">
              <Avatar member={member} />
            </NavLink>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{member?.displayName}</p>
                {session?.user.username && <p className="truncate text-xs text-ink-muted">@{session.user.username}</p>}
              </div>
            )}
            <button
              type="button"
              aria-label="Sign out"
              title="Sign out"
              className="rounded-control p-2 text-ink-muted hover:bg-surface-2 hover:text-ink"
              onClick={async () => {
                await signOut();
                navigate("/sign-in");
              }}
            >
              <LogOut className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-ground/90 px-4 py-2.5 backdrop-blur">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-controls="sidebar"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden rounded-control p-2 text-ink-muted hover:bg-surface-2 hover:text-ink md:inline-flex"
          >
            {collapsed ? <PanelLeftOpen className="size-5" aria-hidden /> : <PanelLeftClose className="size-5" aria-hidden />}
          </button>
          <NavLink to="/" className="flex items-center md:hidden" aria-label="Home">
            <Logo variant="horizontal" className="h-7" />
          </NavLink>
          <div className="flex items-center gap-1">
            <NavLink
              to="/notifications"
              aria-label={unread.notifications ? `Notifications, ${unread.notifications} unread` : "Notifications"}
              className="relative rounded-control p-2 text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <Bell className="size-5" aria-hidden strokeWidth={1.75} />
              {unread.notifications > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent" aria-hidden />}
            </NavLink>
            <NavLink to="/settings" aria-label="Account settings" className="rounded-full p-1 md:hidden">
              <Avatar member={member} size="xs" />
            </NavLink>
          </div>
        </header>

        <InstallBanner />
        {!online && (
          <div role="status" className="flex items-center justify-center gap-2 bg-accent-soft px-4 py-2 text-sm text-ink">
            <WifiOff className="size-4" aria-hidden />
            You are offline. Saved pages stay readable; changes need a connection.
          </div>
        )}

        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 sm:px-6 md:pb-10 md:pt-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface md:hidden">
        <ul className="grid grid-cols-5">
          {mobile.map((item) => (
            <li key={item.label}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) => clsx("relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", isActive ? "text-ink" : "text-ink-muted")}
              >
                <item.icon className="size-5" aria-hidden strokeWidth={1.75} />
                {item.label}
                {item.label === "Messages" && unread.messages > 0 && (
                  <span className="absolute right-1/4 top-1 size-2 rounded-full bg-accent" aria-label={`${unread.messages} unread messages`} />
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <JoinCodeDialog open={joining} onClose={() => setJoining(false)} />
    </div>
  );
}
