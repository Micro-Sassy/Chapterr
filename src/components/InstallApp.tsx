import clsx from "clsx";
import { Download, EllipsisVertical, MonitorDown, Share, SquarePlus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { detectPlatform, promptInstall, useInstallState, type InstallPlatform } from "@/lib/install";
import { Logo } from "./Logo";
import { Button } from "./ui";
import { Dialog } from "./ui/Dialog";

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="smallcaps flex size-7 shrink-0 items-center justify-center rounded-full border border-gold/60 bg-accent-soft text-sm font-semibold text-accent-strong">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

const Kbd = ({ icon: Icon, children }: { icon?: typeof Share; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 rounded border border-line bg-surface-2 px-1.5 py-px align-middle text-[0.95rem] font-medium">
    {Icon && <Icon className="size-4" aria-hidden />}
    {children}
  </span>
);

export function InstallSteps({ platform }: { platform: InstallPlatform }) {
  switch (platform) {
    case "ios":
      return (
        <ol className="space-y-3">
          <Step n={1}>
            Open this page in <strong>Safari</strong> (on iOS 16.4 or later, Chrome and Edge work too).
          </Step>
          <Step n={2}>
            Tap the <Kbd icon={Share}>Share</Kbd> button — at the bottom of the screen on iPhone, top right on iPad.
          </Step>
          <Step n={3}>
            Scroll down and tap <Kbd icon={SquarePlus}>Add to Home Screen</Kbd>, then <strong>Add</strong>.
          </Step>
          <Step n={4}>Open the club from the new icon on your home screen.</Step>
        </ol>
      );
    case "android":
      return (
        <ol className="space-y-3">
          <Step n={1}>
            In Chrome, tap the <Kbd icon={EllipsisVertical}>menu</Kbd> button at the top right.
          </Step>
          <Step n={2}>
            Tap <Kbd>Install app</Kbd> or <Kbd>Add to Home screen</Kbd>, then confirm.
          </Step>
          <Step n={3}>Open the club from the new icon in your app drawer or home screen.</Step>
        </ol>
      );
    case "mac-safari":
      return (
        <ol className="space-y-3">
          <Step n={1}>
            In Safari's menu bar choose <Kbd>File</Kbd> then <Kbd>Add to Dock…</Kbd> (macOS Sonoma or later).
          </Step>
          <Step n={2}>
            Click <strong>Add</strong>. The club opens in its own window from the Dock and Launchpad.
          </Step>
        </ol>
      );
    case "desktop":
      return (
        <ol className="space-y-3">
          <Step n={1}>
            In Chrome or Edge, click the <Kbd icon={MonitorDown}>Install</Kbd> icon at the right end of the address bar.
          </Step>
          <Step n={2}>
            No icon? Open the browser menu and choose <Kbd>Cast, save and share</Kbd> → <Kbd>Install page as app</Kbd> (Chrome) or <Kbd>Apps</Kbd> →{" "}
            <Kbd>Install this site as an app</Kbd> (Edge).
          </Step>
          <Step n={3}>The club opens in its own window and appears with your other apps.</Step>
        </ol>
      );
    default:
      return (
        <p>
          This browser can't install web apps. Open <strong>{window.location.host}</strong> in Chrome, Edge or Safari to install it — or keep using it
          right here, everything works the same.
        </p>
      );
  }
}

/** "Install app": uses the browser's one-tap dialog when offered, otherwise shows step-by-step instructions. */
export function InstallAppButton({ className, variant = "secondary", label = "Install app" }: { className?: string; variant?: "primary" | "secondary" | "ghost"; label?: string }) {
  const { standalone, justInstalled, canPrompt } = useInstallState();
  const [open, setOpen] = useState(false);
  if (standalone) return null;
  if (justInstalled) {
    return <p className={clsx("text-sm italic text-ink-muted", className)}>Installed — open it from your home screen or apps.</p>;
  }
  return (
    <>
      <Button
        variant={variant}
        icon={Download}
        className={className}
        onClick={async () => {
          if (canPrompt) {
            const accepted = await promptInstall();
            if (!accepted) setOpen(true);
          } else setOpen(true);
        }}
      >
        {label}
      </Button>
      <InstallDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function InstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const platform = detectPlatform();
  return (
    <Dialog open={open} onClose={onClose} title="Install the club app">
      <div className="space-y-5">
        <div className="flex justify-center">
          <Logo variant="stacked" className="w-40" decorative />
        </div>
        <p className="text-center italic text-ink-muted">Get an icon on your home screen, a full-screen window, and pages that open even when you're offline.</p>
        <InstallSteps platform={platform} />
        <p className="text-sm text-ink-muted">It's free, takes no storage to speak of, and updates itself — no app store needed.</p>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const DISMISS_KEY = "trbc:install-banner-dismissed";
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

/** A gentle, dismissible invitation to install, shown on phones and wherever the browser supports one-tap install. */
export function InstallBanner() {
  const { standalone, canPrompt } = useInstallState();
  const [hidden, setHidden] = useState(dismissedRecently);
  const platform = detectPlatform();
  const relevant = canPrompt || platform === "ios" || platform === "android";
  if (standalone || hidden || !relevant) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage unavailable: hide for this visit only */
    }
    setHidden(true);
  };
  return (
    <div role="region" aria-label="Install the app" className="flex items-center gap-3 border-b border-line bg-accent-soft px-4 py-2.5">
      <img src="/icons/icon-192.png" alt="" width={36} height={36} className="size-9 rounded-lg shadow-sm" />
      <p className="min-w-0 flex-1 text-[0.95rem] leading-snug">
        <strong>Add the club to your home screen</strong>
        <span className="hidden text-ink-muted sm:inline"> — opens like an app, works offline.</span>
      </p>
      <InstallAppButton variant="primary" label="Install" className="h-8 px-3 text-[0.95rem]" />
      <button type="button" onClick={dismiss} aria-label="Not now" title="Not now" className="rounded-full p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
