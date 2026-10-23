import type { ReactNode } from "react";
import { Link } from "react-router";
import { APP_TAGLINE } from "@shared/constants";
import { InstallAppButton } from "@/components/InstallApp";
import { Logo } from "@/components/Logo";
import { useConfig } from "@/lib/config";
import { useDocumentTitle } from "@/lib/hooks";

export const MARKETING_URL = "https://chapterr.io";

/** Centred card used by sign-in, registration, recovery, invite landing and legal pages. */
export function AuthLayout({ title, subtitle, children, footer, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useDocumentTitle(title);
  const { data: config } = useConfig();
  const about = config?.marketingUrl || MARKETING_URL;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link to="/" className="mb-8 block rounded-control" aria-label="Chapterr home">
        <Logo variant="vertical" className="h-28 sm:h-32" />
      </Link>
      <main className={`w-full rounded-large border border-line bg-surface p-6 sm:p-8 ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <h1 className="display-l text-balance text-center">{title}</h1>
        {subtitle && <p className="mt-2 text-center text-ink-muted">{subtitle}</p>}
        <div className="mt-7">{children}</div>
      </main>
      {footer && <div className="mt-6 text-center text-sm text-ink-muted">{footer}</div>}
      <p className="mt-6 text-center text-xs text-ink-muted">
        <span className="font-display text-sm text-ink">{APP_TAGLINE}</span>
        <br />
        <a href={about} className="underline hover:text-ink" rel="noopener">
          About Chapterr
        </a>
        {" · "}
        <Link to="/privacy" className="underline hover:text-ink">
          Privacy
        </Link>
        {" · "}
        <Link to="/terms" className="underline hover:text-ink">
          Terms
        </Link>
      </p>
      <InstallAppButton variant="ghost" className="mt-3 text-ink-muted" label="Install app" />
    </div>
  );
}
