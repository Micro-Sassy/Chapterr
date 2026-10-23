import { EmptyState, PageHeader } from "@/components/ui";
import { useDocumentTitle } from "@/lib/hooks";

/** Feature wave 2 placeholder; replaced by the owning UI stream (docs/FEATURES-2.md §9). */
export function CalendarPage() {
  useDocumentTitle("Calendar");
  return (
    <div>
      <PageHeader title="Calendar" description="Meetings, due dates and polls by month and year." />
      <EmptyState title="Coming soon">This page is being built.</EmptyState>
    </div>
  );
}
