import { EmptyState, PageHeader } from "@/components/ui";
import { useDocumentTitle } from "@/lib/hooks";

/** Feature wave 2 placeholder; replaced by the owning UI stream (docs/FEATURES-2.md §9). */
export function WrappedPage() {
  useDocumentTitle("Club Wrapped");
  return (
    <div>
      <PageHeader title="Club Wrapped" description="The club's year in review and monthly recaps." />
      <EmptyState title="Coming soon">This page is being built.</EmptyState>
    </div>
  );
}
