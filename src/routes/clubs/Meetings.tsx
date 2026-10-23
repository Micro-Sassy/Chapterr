export { MeetingsPage } from "./ClubExtras";
import { EmptyState, PageHeader } from "@/components/ui";
import { useDocumentTitle } from "@/lib/hooks";

/** Feature wave 2 placeholder; replaced by the owning UI stream (docs/FEATURES-2.md §9). */
export function MeetingDetailPage() {
  useDocumentTitle("Meeting");
  return (
    <div>
      <PageHeader title="Meeting" description="RSVP, roles, notes, sign-ups and the meeting pack." />
      <EmptyState title="Coming soon">This page is being built.</EmptyState>
    </div>
  );
}
