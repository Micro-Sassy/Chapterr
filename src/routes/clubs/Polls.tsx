import { EmptyState, PageHeader } from "@/components/ui";
import { useDocumentTitle } from "@/lib/hooks";

/** Feature wave 2 placeholder; replaced by the owning UI stream (docs/FEATURES-2.md §9). */
export function PollsPage() {
  useDocumentTitle("Polls");
  return (
    <div>
      <PageHeader title="Polls" description="Vote on the next book, meeting dates and anything else." />
      <EmptyState title="Coming soon">This page is being built.</EmptyState>
    </div>
  );
}
