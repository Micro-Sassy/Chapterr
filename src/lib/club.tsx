import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useParams } from "react-router";
import type { Club, ClubSummary, Me } from "@shared/types";
import { api } from "./api";
import { useSession } from "./auth";

/** The signed-in member's account, clubs and last-opened club. */
export function useMe() {
  const { data: session } = useSession();
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/account/me"), enabled: !!session, staleTime: 60_000 });
}

export const clubPath = (clubId: string, sub?: string) => `/c/${clubId}${sub ? `/${sub}` : ""}`;

/** The club in the URL, if the current route is a club route. */
export function useClubIdParam(): string | undefined {
  return useParams().clubId;
}

const LAST_CLUB_KEY = "chapterr:last-club";

function readLocalLastClub(): string | null {
  try {
    return localStorage.getItem(LAST_CLUB_KEY);
  } catch {
    return null;
  }
}

/** Where "the club" points when the URL has none: the last-opened club, else the first one. */
export function useCurrentClubId(): string | null {
  const fromUrl = useClubIdParam();
  const me = useMe();
  if (fromUrl) return fromUrl;
  const clubs = me.data?.clubs ?? [];
  const candidates = [me.data?.lastClubId, readLocalLastClub()];
  for (const id of candidates) if (id && clubs.some((c) => c.id === id)) return id;
  return clubs[0]?.id ?? null;
}

export function useCurrentClub(): ClubSummary | null {
  const id = useCurrentClubId();
  const me = useMe();
  return me.data?.clubs.find((c) => c.id === id) ?? null;
}

/** Record the club being viewed so the next sign-in opens it (local copy for instant use). */
export function useRecordLastClub(clubId: string | undefined) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (id: string) => api("/api/account/last-club", { method: "PUT", body: { clubId: id } }),
    onSuccess: (_d, id) => qc.setQueryData<Me>(["me"], (prev) => (prev ? { ...prev, lastClubId: id } : prev)),
  });
  const mutate = save.mutate;
  useEffect(() => {
    if (!clubId) return;
    try {
      if (localStorage.getItem(LAST_CLUB_KEY) === clubId) return;
      localStorage.setItem(LAST_CLUB_KEY, clubId);
    } catch {
      /* storage unavailable */
    }
    mutate(clubId);
  }, [clubId, mutate]);
}

/** A join link opened while signed out is remembered until the member is back. */
const PENDING_JOIN_KEY = "chapterr:pending-join";
export function rememberPendingJoin(code: string) {
  try {
    localStorage.setItem(PENDING_JOIN_KEY, code);
  } catch {
    /* ignore */
  }
}
export function takePendingJoin(): string | null {
  try {
    const code = localStorage.getItem(PENDING_JOIN_KEY);
    if (code) localStorage.removeItem(PENDING_JOIN_KEY);
    return code;
  } catch {
    return null;
  }
}

// --- Club context (provided by the /c/:clubId layout) --------------------------------

const ClubContext = createContext<Club | null>(null);

export function ClubProvider({ club, children }: { club: Club; children: ReactNode }) {
  return <ClubContext.Provider value={club}>{children}</ClubContext.Provider>;
}

/** The club of the current /c/:clubId route. Throws outside club routes. */
export function useClub(): Club {
  const club = useContext(ClubContext);
  if (!club) throw new Error("useClub must be used inside a club route");
  return club;
}

export const isAdmin = (club: Pick<ClubSummary, "role">) => club.role === "owner" || club.role === "admin";
