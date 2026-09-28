import type { ReactNode } from "react";
import { Link } from "react-router";
import { Logo } from "@/components/Logo";
import { useDocumentTitle } from "@/lib/hooks";

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link to="/" className="mb-7 block">
        <Logo variant="stacked" className="w-56 sm:w-64" />
      </Link>
      <main className="bookplate w-full max-w-md rounded-[var(--radius)] border border-line bg-surface p-6 shadow-[var(--shadow-book)] sm:p-8">
        <h1 className="text-center text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-center italic text-ink-muted">{subtitle}</p>}
        <div className="ornament mt-4" aria-hidden>
          <span className="text-xs">&#9670;</span>
        </div>
        <div className="mt-6">{children}</div>
      </main>
      {footer && <div className="mt-6 text-center text-sm text-ink-muted">{footer}</div>}
    </div>
  );
}
