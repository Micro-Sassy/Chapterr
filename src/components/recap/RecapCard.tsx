import { Download, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MonthlyRecap } from "@shared/types";
import { BookRow } from "@/components/books";
import { Alert, Button, Card, Stat } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { coverSrc } from "@/lib/covers";
import { canShareFiles, downloadBlob, drawMonthlyRecap, ensureFonts, loadImage, monthLabel, renderToBlob, shareBlob, SQUARE } from "./canvas";

/** Monthly recap with a live preview of the 1080x1080 graphic, download and share. */
export function RecapCard({ recap, subject, accent, title = "Monthly recap" }: { recap: MonthlyRecap; subject: string; accent?: string | null; title?: string }) {
  const toast = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const covers = async () => {
    const imgs = await Promise.all(recap.booksFinished.slice(0, 6).map((b) => loadImage(coverSrc(b.edition.coverUrl))));
    return imgs.filter((i): i is HTMLImageElement => !!i);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureFonts();
      const imgs = await covers();
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawMonthlyRecap(ctx, recap, { subject, accent, covers: imgs }, SQUARE);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recap, subject, accent]);

  const build = async () => {
    const imgs = await covers();
    return renderToBlob(SQUARE, (ctx) => drawMonthlyRecap(ctx, recap, { subject, accent, covers: imgs }, SQUARE));
  };
  const filename = `chapterr-recap-${recap.period}.png`;

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label text-ink-muted">{title}</p>
          <h3 className="heading-m mt-1">{monthLabel(recap.period)}</h3>
          <p className="mt-1 max-w-prose text-sm">{recap.headline}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            icon={Download}
            loading={busy === "download"}
            onClick={async () => {
              setBusy("download");
              setError(null);
              try {
                downloadBlob(await build(), filename);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not create the image.");
              } finally {
                setBusy(null);
              }
            }}
          >
            Download image
          </Button>
          {canShareFiles() && (
            <Button
              variant="secondary"
              icon={Share2}
              loading={busy === "share"}
              onClick={async () => {
                setBusy("share");
                try {
                  const ok = await shareBlob(await build(), filename, `${subject}: ${monthLabel(recap.period)} on Chapterr`);
                  if (!ok) toast("Sharing is not available here. Download the image instead.", "error");
                } finally {
                  setBusy(null);
                }
              }}
            >
              Share
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat value={recap.booksFinished.length} label={recap.booksFinished.length === 1 ? "book finished" : "books finished"} />
            <Stat value={recap.pagesRead.toLocaleString()} label="pages read" />
            <Stat value={recap.streakBest} label="best streak (days)" />
            <Stat value={recap.meetingsAttended} label={recap.meetingsAttended === 1 ? "meeting attended" : "meetings attended"} />
            <Stat value={recap.quotesSaved} label="quotes saved" />
            <Stat value={recap.reviewsWritten} label="reviews written" />
          </div>
          {recap.topGenre && <p className="text-sm text-ink-muted">Most read genre: {recap.topGenre}</p>}
          {recap.booksFinished.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {recap.booksFinished.slice(0, 6).map((b, i) => (
                <li key={`${b.edition.id}-${i}`}>
                  <BookRow edition={b.edition} meta={b.by ? `Finished by ${b.by.displayName}` : undefined} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <canvas ref={canvasRef} width={SQUARE.width} height={SQUARE.height} className="w-full rounded-control border border-line" aria-label={`Preview of the ${monthLabel(recap.period)} recap graphic`} role="img" />
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </Card>
  );
}
