import { EmptyState, PageHeader } from "@/components/ui";
import { useDocumentTitle } from "@/lib/hooks";

/** Feature wave 2 placeholder; replaced by the owning UI stream (docs/FEATURES-2.md §9). */
export function RoomsPage() {
  useDocumentTitle("Discussion rooms");
  return (
    <div>
      <PageHeader title="Discussion rooms" description="Spoiler-safe rooms that open as you read." />
      <EmptyState title="Coming soon">This page is being built.</EmptyState>
    </div>
  );
}
