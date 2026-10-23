import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { useToast } from "./ui/Toast";

/** Standard handling for shared-record mutations: refresh on success, explain 409 conflicts. */
export function useSharedMutation<TVars>(fn: (v: TVars) => Promise<unknown>, keys: unknown[][], success?: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const k of keys) void qc.invalidateQueries({ queryKey: k });
      if (success) toast(success);
    },
    onError: (err) => {
      if (err instanceof ApiRequestError && err.status === 409) {
        for (const k of keys) void qc.invalidateQueries({ queryKey: k });
        toast("Someone else changed this first. The latest version is shown; try again.", "error");
        return;
      }
      toast(errorMessage(err), "error");
    },
  });
}

export function AuditLine({ item }: { item: { createdBy: { displayName: string } | null; updatedBy: { displayName: string } | null; createdAt: string; updatedAt: string } }) {
  return (
    <span className="text-xs text-ink-muted">
      Added by {item.createdBy?.displayName ?? "a former member"}
      {item.updatedAt !== item.createdAt && item.updatedBy ? ` · edited by ${item.updatedBy.displayName} ${relativeTime(item.updatedAt)}` : ""}
    </span>
  );
}

/** Club-scoped API path helper. */
export const clubApi = (clubId: string, path: string) => `/api/clubs/${encodeURIComponent(clubId)}${path}`;

export { api };
