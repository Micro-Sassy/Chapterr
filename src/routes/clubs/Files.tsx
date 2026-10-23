import { EmptyState, PageHeader } from "@/components/ui";
import { useDocumentTitle } from "@/lib/hooks";

/** Feature wave 2 placeholder; replaced by the owning UI stream (docs/FEATURES-2.md §9). */
export function FilesPage() {
  useDocumentTitle("Files");
  return (
    <div>
      <PageHeader title="Files" description="Minutes, photos and recipes for the club." />
      <EmptyState title="Coming soon">This page is being built.</EmptyState>
    </div>
  );
}
