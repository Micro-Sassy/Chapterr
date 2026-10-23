import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useEffect } from "react";
import { Outlet, useParams } from "react-router";
import type { Club } from "@shared/types";
import { EmptyState, LinkButton, Spinner } from "@/components/ui";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { ClubProvider, useRecordLastClub } from "@/lib/club";

export function useClubQuery(clubId: string | undefined) {
  return useQuery({
    queryKey: ["club", clubId],
    queryFn: () => api<Club>(`/api/clubs/${encodeURIComponent(clubId!)}`),
    enabled: !!clubId,
    staleTime: 60_000,
  });
}

/**
 * Layout for every /c/:clubId route: loads the club, provides it to children,
 * remembers it as the member's last club and explains lost access plainly.
 */
export function ClubLayout() {
  const { clubId } = useParams();
  const q = useClubQuery(clubId);
  const accessible = q.isSuccess ? clubId : undefined;
  useRecordLastClub(accessible);

  useEffect(() => {
    if (q.data) document.title = `${q.data.name} · Chapterr`;
  }, [q.data]);

  if (q.isPending) return <Spinner label="Opening the club" />;
  if (q.isError) {
    const gone = q.error instanceof ApiRequestError && (q.error.status === 403 || q.error.status === 404);
    return (
      <EmptyState icon={Users} title={gone ? "This club isn't open to you" : "Couldn't open the club"} action={<LinkButton to="/">Go home</LinkButton>}>
        {gone ? "It may have been deleted, or you're no longer a member. Ask an admin for a new invite." : errorMessage(q.error)}
      </EmptyState>
    );
  }
  return (
    <ClubProvider club={q.data}>
      <Outlet />
    </ClubProvider>
  );
}
