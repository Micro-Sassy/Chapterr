import { useQuery } from "@tanstack/react-query";
import { Copy, Mail, MessageSquare, Share2 } from "lucide-react";
import { useState } from "react";
import type { ShareLinks, ShareLinksExtras } from "@shared/types";
import { clubApi } from "@/components/records";
import { Alert, Button, buttonClass, Spinner } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { api, errorMessage } from "@/lib/api";

type Links = ShareLinks & Partial<ShareLinksExtras>;

/** Hand the meeting to WhatsApp, Messages or email; or copy the text. */
export function ShareSheet({ open, onClose, clubId, meetingId }: { open: boolean; onClose: () => void; clubId: string; meetingId: string }) {
  const q = useQuery({ queryKey: ["meeting-share", clubId, meetingId], queryFn: () => api<Links>(clubApi(clubId, `/bridge/share?kind=meeting&id=${encodeURIComponent(meetingId)}`)), enabled: open, staleTime: 60_000 });
  const [copied, setCopied] = useState(false);
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const text = q.data?.copy ?? (q.data ? `${q.data.text}\n${q.data.url}` : "");
  return (
    <Dialog open={open} onClose={onClose} title="Share meeting">
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data && (
        <div className="space-y-4">
          <pre className="whitespace-pre-wrap rounded-control border border-line bg-surface-2/50 p-3 text-sm">{text}</pre>
          <div className="grid gap-2 sm:grid-cols-2">
            <a href={q.data.whatsapp} target="_blank" rel="noreferrer noopener" className={buttonClass("secondary")}>
              <MessageSquare className="size-4" aria-hidden /> WhatsApp
            </a>
            <a href={q.data.sms} className={buttonClass("secondary")}>
              <MessageSquare className="size-4" aria-hidden /> Messages
            </a>
            <a href={q.data.email} className={buttonClass("secondary")}>
              <Mail className="size-4" aria-hidden /> Email
            </a>
            <Button
              variant="secondary"
              icon={Copy}
              onClick={async () => {
                await navigator.clipboard?.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copied" : "Copy text"}
            </Button>
          </div>
          {canNativeShare && (
            <Button icon={Share2} onClick={() => navigator.share({ title: q.data!.text, text: q.data!.text, url: q.data!.url }).catch(() => undefined)}>
              Share
            </Button>
          )}
        </div>
      )}
    </Dialog>
  );
}
