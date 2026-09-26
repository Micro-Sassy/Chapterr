import { BookMarked } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useDocumentTitle } from "@/lib/hooks";

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link to="/" className="mb-6 flex items-center gap-2 text-ink">
        <BookMarked className="size-7 text-accent" aria-hidden />
        <span className="font-serif text-xl font-semibold">Teel Ridge Book Club</span>
      </Link>
      <main className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </main>
      {footer && <div className="mt-6 text-center text-sm text-ink-muted">{footer}</div>}
    </div>
  );
}
