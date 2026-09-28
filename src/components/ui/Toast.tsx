import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  tone: "success" | "error";
}

const ToastContext = createContext<(message: string, tone?: "success" | "error") => void>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: "success" | "error" = "success") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-3), { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), tone === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex max-w-md items-center gap-2 rounded-[var(--radius)] border border-line bg-surface px-4 py-3 text-sm shadow-lg"
          >
            {t.tone === "success" ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden /> : <AlertCircle className="size-4 shrink-0 text-danger" aria-hidden />}
            <span>{t.message}</span>
            <button type="button" aria-label="Dismiss" className="ml-2 text-ink-muted" onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
