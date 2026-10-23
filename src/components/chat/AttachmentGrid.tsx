import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Attachment } from "@shared/types";
import { cx } from "@/components/ui";

export interface GridImage {
  url: string;
  title: string | null;
  width?: number | null;
  height?: number | null;
}

export const toGridImages = (attachments: Attachment[]): GridImage[] => attachments.map((a) => ({ url: a.url, title: a.title, width: a.width, height: a.height }));

/**
 * One to four photos laid out as a compact grid. Tapping a photo opens the
 * lightbox; `pending` renders local previews dimmed while the upload is in flight.
 */
export function AttachmentGrid({ images, pending, className }: { images: GridImage[]; pending?: boolean; className?: string }) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  if (images.length === 0) return null;
  const shown = images.slice(0, 4);
  const layout = shown.length === 1 ? "grid-cols-1" : shown.length === 2 ? "grid-cols-2" : "grid-cols-2";
  return (
    <>
      <ul className={cx("grid gap-1 overflow-hidden rounded-control", layout, pending && "opacity-60", className)} aria-label={`${shown.length} ${shown.length === 1 ? "photo" : "photos"}`}>
        {shown.map((img, i) => (
          <li key={`${img.url}-${i}`} className={cx(shown.length === 3 && i === 0 && "row-span-2")}>
            <button
              type="button"
              disabled={pending}
              aria-label={img.title ? `Open photo: ${img.title}` : `Open photo ${i + 1} of ${shown.length}`}
              onClick={(e) => {
                opener.current = e.currentTarget;
                setOpenAt(i);
              }}
              className="block size-full focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-focus)]"
            >
              <img
                src={img.url}
                alt={img.title ?? ""}
                loading="lazy"
                className={cx("size-full object-cover", shown.length === 1 ? "max-h-80 w-auto max-w-full" : "aspect-square", shown.length === 3 && i === 0 && "aspect-auto h-full")}
              />
            </button>
          </li>
        ))}
      </ul>
      {openAt !== null && (
        <Lightbox
          images={shown}
          index={openAt}
          onIndex={setOpenAt}
          onClose={() => {
            setOpenAt(null);
            opener.current?.focus();
          }}
        />
      )}
    </>
  );
}

/**
 * Full-screen viewer on the native dialog element: Escape closes (handled by
 * the browser via cancel), arrow keys move between photos, focus starts on Close
 * and returns to the thumbnail that opened it.
 */
export function Lightbox({ images, index, onIndex, onClose }: { images: GridImage[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const current = images[index] ?? images[0];
  const prev = () => onIndex((index - 1 + images.length) % images.length);
  const next = () => onIndex((index + 1) % images.length);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    }
    closeBtn.current?.focus();
    return () => {
      if (el.open) {
        if (typeof el.close === "function") el.close();
        else el.removeAttribute("open");
      }
    };
  }, []);

  if (!current) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "ArrowLeft" && images.length > 1) {
      e.preventDefault();
      prev();
    } else if (e.key === "ArrowRight" && images.length > 1) {
      e.preventDefault();
      next();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <dialog
      ref={ref}
      aria-label={current.title ? `Photo: ${current.title}` : `Photo ${index + 1} of ${images.length}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 backdrop:bg-[rgb(20_42_34/0.92)]"
    >
      <div className="flex h-full flex-col text-on-primary">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-sm text-on-primary/80">
            {images.length > 1 && (
              <span aria-live="polite">
                {index + 1} of {images.length}
              </span>
            )}
            {current.title && <span className="ml-2">{current.title}</span>}
          </p>
          <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close" className="rounded-control p-2 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-on-primary">
            <X className="size-6" aria-hidden />
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center px-14">
          {images.length > 1 && (
            <button type="button" onClick={prev} aria-label="Previous photo" className="absolute left-3 rounded-control p-2 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-on-primary">
              <ChevronLeft className="size-7" aria-hidden />
            </button>
          )}
          <img src={current.url} alt={current.title ?? ""} className="max-h-full max-w-full rounded-[4px] object-contain" />
          {images.length > 1 && (
            <button type="button" onClick={next} aria-label="Next photo" className="absolute right-3 rounded-control p-2 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-on-primary">
              <ChevronRight className="size-7" aria-hidden />
            </button>
          )}
        </div>
        <div className="h-6" />
      </div>
    </dialog>
  );
}
