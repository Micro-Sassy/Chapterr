import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** Accessible modal built on the native <dialog> element (focus trapping and Esc handled by the browser). */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    } else if (!open && el.open) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
      className={`m-auto w-[calc(100%-2rem)] ${wide ? "max-w-2xl" : "max-w-lg"} rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl`}
    >
      {open && (
        <div className="max-h-[85dvh] overflow-y-auto p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-xl font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 text-ink-muted hover:bg-surface-2 hover:text-ink">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
