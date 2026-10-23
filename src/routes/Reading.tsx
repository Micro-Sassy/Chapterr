import { EmptyState, PageHeader } from "@/components/ui";
import { useDocumentTitle } from "@/lib/hooks";

/** Feature wave 2 placeholder; replaced by the owning UI stream (docs/FEATURES-2.md §9). */
export function ReadingPage() {
  useDocumentTitle("Reading");
  return (
    <div>
      <PageHeader title="Reading" description="Your reading log, streak, recaps and challenges." />
      <EmptyState title="Coming soon">This page is being built.</EmptyState>
    </div>
  );
}
