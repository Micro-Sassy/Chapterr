import { useQuery } from "@tanstack/react-query";
import type { Page, Poll } from "@shared/types";
import { api } from "@/lib/api";
import { clubApi } from "@/components/records";

export const pollKeys = {
  all: (clubId: string) => ["polls", clubId] as const,
  list: (clubId: string, status: "open" | "closed") => ["polls", clubId, status] as const,
  detail: (clubId: string, pollId: string) => ["poll", clubId, pollId] as const,
};

export const pollInvalidations = (clubId: string): unknown[][] => [[...pollKeys.all(clubId)], ["poll", clubId], ["calendar", clubId], ["club-books", clubId], ["meetings", clubId], ["club-dashboard", clubId], ["home"]];

/** `GET /polls?status=` is paged; accept a bare array too while the API settles. */
export function usePolls(clubId: string, status: "open" | "closed") {
  return useQuery({
    queryKey: pollKeys.list(clubId, status),
    queryFn: async () => {
      const res = await api<Page<Poll> | Poll[]>(clubApi(clubId, `/polls?status=${status}`));
      return Array.isArray(res) ? res : res.items;
    },
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

/** One poll: `GET /polls/:id`, falling back to the lists when the API has no detail route. */
export function usePoll(clubId: string, pollId: string | undefined) {
  return useQuery({
    queryKey: pollKeys.detail(clubId, pollId ?? ""),
    queryFn: async () => {
      try {
        return await api<Poll>(clubApi(clubId, `/polls/${encodeURIComponent(pollId!)}`));
      } catch (err) {
        const [open, closed] = await Promise.all([api<Page<Poll> | Poll[]>(clubApi(clubId, "/polls?status=open")), api<Page<Poll> | Poll[]>(clubApi(clubId, "/polls?status=closed"))]);
        const all = [...(Array.isArray(open) ? open : open.items), ...(Array.isArray(closed) ? closed : closed.items)];
        const found = all.find((p) => p.id === pollId);
        if (!found) throw err;
        return found;
      }
    },
    enabled: !!pollId,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

export const POLL_KIND_LABELS = { book: "Next book", date: "Meeting date", custom: "Question" } as const;

/** Whether members may add options while the poll is open. */
export const allowsMemberOptions = (poll: Poll): boolean => poll.allowMemberOptions ?? true;
