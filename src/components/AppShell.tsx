import clsx from "clsx";
import {
  Bell,
  Home,
  Library,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  MessageCircle,
  Quote,
  Settings,
  Sparkles,
  Target,
  Users,
  UsersRound,
  WifiOff,
  Star,
  Search,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { useSession, useSignOut } from "@/lib/auth";
import { useOnline } from "@/lib/hooks";
import { Avatar } from "./Avatar";
import { InstallAppButton, InstallBanner } from "./InstallApp";
import { Logo } from "./Logo";
import type { Me } from "@shared/types";

export const NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/library", label: "My library", icon: Library },
  { to: "/books/add", label: "Find books", icon: Search },
  { to: "/club", label: "Club", icon: UsersRound },
  { to: "/messages", label: "Messages", icon: MessageCircle },
  { to: "/recommendations", label: "Recommendations", icon: Sparkles },
  { to: "/reviews", label: "Reviews", icon: Star },
  { to: "/quotes", label: "Quotes", icon: Quote },
  { to: "/goals", label: "Goals", icon: Target },
  { to: "/members", label: "Members", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const MOBILE = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/library", label: "Library", icon: Library },
  { to: "/club", label: "Club", icon: UsersRound },
  { to: "/messages", label: "Messages", icon: MessageCircle },
  { to: "/more", label: "More", icon: Menu },
] as const;

function useUnread() {
  const messages = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api<{ unreadCount: number }[]>("/api/conversations"),
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
    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-highlight px-1.5 text-[11px] font-bold text-white" aria-label={`${count} ${label}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

const COLLAPSE_KEY = "trbc:sidebar-collapsed";

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

export function AppShell() {
  const online = useOnline();
  const { data: session } = useSession();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/account/me"), enabled: !!session });
  const unread = useUnread();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [collapsed, toggleSidebar] = useSidebarCollapsed();

  const member = me.data ?? (session ? { displayName: session.user.name, avatarUrl: session.user.image } : null);

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* Desktop / tablet sidebar */}
      <aside
        id="sidebar"
        className={clsx(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r-4 border-double border-line bg-surface transition-[width] duration-200 md:flex",
          collapsed ? "w-[4.5rem]" : "w-64",
        )}
      >
        <NavLink to="/" aria-label="Home" className={clsx("block", collapsed ? "px-2 pb-3 pt-5" : "px-5 pb-4 pt-6")}>
          {collapsed ? <Logo variant="mark" className="mx-auto w-12" /> : <Logo variant="stacked" className="mx-auto w-40" />}
        </NavLink>
        <div className={clsx("ornament mb-3", collapsed ? "mx-3" : "mx-5")} aria-hidden>
          <span className="text-[0.6rem]">&#9670;</span>
        </div>
        <nav aria-label="Main" className={clsx("flex-1 overflow-y-auto overflow-x-hidden", collapsed ? "px-2" : "px-3")}>
          <ul className="space-y-0.5">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={"end" in item ? item.end : undefined}
                  title={collapsed ? item.label : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    clsx(
                      "relative flex items-center gap-3 rounded-[var(--radius)] border-l-2 py-1.5 text-[1.02rem]",
                      collapsed ? "justify-center px-0 py-2" : "px-3",
                      isActive
                        ? "border-gold bg-accent-soft font-semibold text-accent-strong"
                        : "border-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
                    )
                  }
                >
                  <item.icon className={collapsed ? "size-5" : "size-4"} aria-hidden />
                  {!collapsed && item.label}
                  {item.to === "/messages" &&
                    (collapsed ? (
                      unread.messages > 0 && <span className="absolute right-2 top-1.5 size-2 rounded-full bg-highlight" aria-hidden />
                    ) : (
                      <CountBadge count={unread.messages} label="unread messages" />
                    ))}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className={clsx("pb-3", collapsed ? "px-2" : "px-3")}>
          <InstallAppButton variant="ghost" iconOnly={collapsed} className={clsx("w-full text-ink-muted", !collapsed && "justify-start")} />
        </div>
        <div className={clsx("border-t border-line", collapsed ? "p-2" : "p-3")}>
          <div className={clsx("flex items-center gap-2 py-2", collapsed ? "flex-col px-0" : "px-2")}>
            <Avatar member={member} />
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
              className="rounded-full p-2 text-ink-muted hover:bg-surface-2 hover:text-ink"
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
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-paper/90 px-4 py-2.5 backdrop-blur">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-controls="sidebar"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden rounded-full p-2 text-ink-muted hover:bg-surface-2 hover:text-ink md:inline-flex"
          >
            {collapsed ? <PanelLeftOpen className="size-5" aria-hidden /> : <PanelLeftClose className="size-5" aria-hidden />}
          </button>
          <NavLink to="/" className="flex items-center md:hidden">
            <Logo variant="horizontal" className="h-9 w-auto" />
          </NavLink>
          <div className="flex items-center gap-1">
            <NavLink
              to="/notifications"
              aria-label={unread.notifications ? `Notifications, ${unread.notifications} unread` : "Notifications"}
              className="relative rounded-full p-2 text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <Bell className="size-5" aria-hidden />
              {unread.notifications > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-highlight" aria-hidden />}
            </NavLink>
            <NavLink to="/settings" aria-label="Settings" className="rounded-full p-1 md:hidden">
              <Avatar member={member} size="xs" />
            </NavLink>
          </div>
        </header>

        <InstallBanner />
        {!online && (
          <div role="status" className="flex items-center justify-center gap-2 bg-highlight-soft px-4 py-2 text-sm text-ink">
            <WifiOff className="size-4" aria-hidden />
            You are offline. Saved pages stay readable; changes need a connection.
          </div>
        )}

        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 sm:px-6 md:pb-10">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface md:hidden">
        <ul className="grid grid-cols-5">
          {MOBILE.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={"end" in item ? item.end : undefined}
                className={({ isActive }) =>
                  clsx("relative flex flex-col items-center gap-0.5 py-2 text-[11px]", isActive ? "font-semibold text-accent-strong" : "text-ink-muted")
                }
              >
                <item.icon className="size-5" aria-hidden />
                {item.label}
                {item.to === "/messages" && unread.messages > 0 && (
                  <span className="absolute right-1/4 top-1 size-2 rounded-full bg-highlight" aria-label={`${unread.messages} unread messages`} />
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
