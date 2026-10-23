import { EmptyState, PageHeader } from "@/components/ui";
import { useDocumentTitle } from "@/lib/hooks";

/** Feature wave 2 placeholder; replaced by the owning UI stream (docs/FEATURES-2.md §9). */
export function ClubChallengesPage() {
  useDocumentTitle("Challenges");
  return (
    <div>
      <PageHeader title="Challenges" description="Reading challenges and the leaderboard." />
      <EmptyState title="Coming soon">This page is being built.</EmptyState>
    </div>
  );
}
