import clsx from "clsx";
import { Download, EllipsisVertical, MonitorDown, Share, SquarePlus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { APP_NAME } from "@shared/constants";
import { detectPlatform, promptInstall, useInstallState, type InstallPlatform } from "@/lib/install";
import { Logo } from "./Logo";
import { Button } from "./ui";
import { Dialog } from "./ui/Dialog";

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-on-primary">{n}</span>
      <span className="pt-0.5 text-sm">{children}</span>
    </li>
  );
}

const Kbd = ({ icon: Icon, children }: { icon?: typeof Share; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 rounded-chip border border-line bg-surface-2 px-1.5 py-px align-middle text-[13px] font-medium">
    {Icon && <Icon className="size-3.5" aria-hidden />}
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
            Tap the <Kbd icon={Share}>Share</Kbd> button, at the bottom of the screen on iPhone or top right on iPad.
          </Step>
          <Step n={3}>
            Scroll down and tap <Kbd icon={SquarePlus}>Add to Home Screen</Kbd>, then <strong>Add</strong>.
          </Step>
          <Step n={4}>Open {APP_NAME} from the new icon on your home screen.</Step>
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
          <Step n={3}>Open {APP_NAME} from the new icon in your app drawer or home screen.</Step>
        </ol>
      );
    case "mac-safari":
      return (
        <ol className="space-y-3">
          <Step n={1}>
            In Safari's menu bar choose <Kbd>File</Kbd> then <Kbd>Add to Dock…</Kbd> (macOS Sonoma or later).
          </Step>
          <Step n={2}>
            Click <strong>Add</strong>. {APP_NAME} opens in its own window from the Dock and Launchpad.
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
            No icon? Open the browser menu and choose <Kbd>Cast, save and share</Kbd> then <Kbd>Install page as app</Kbd> (Chrome), or <Kbd>Apps</Kbd> then{" "}
            <Kbd>Install this site as an app</Kbd> (Edge).
          </Step>
          <Step n={3}>{APP_NAME} opens in its own window and appears with your other apps.</Step>
        </ol>
      );
    default:
      return (
        <p className="text-sm">
          This browser can't install web apps. Open <strong>{window.location.host}</strong> in Chrome, Edge or Safari to install it, or keep using it right here.
          Everything works the same.
        </p>
      );
  }
}

/** "Install app": uses the browser's one-tap dialog when offered, otherwise shows step-by-step instructions. */
export function InstallAppButton({
  className,
  variant = "secondary",
  label = "Install app",
  iconOnly = false,
}: {
  className?: string;
  variant?: "primary" | "secondary" | "ghost";
  label?: string;
  iconOnly?: boolean;
}) {
  const { standalone, justInstalled, canPrompt } = useInstallState();
  const [open, setOpen] = useState(false);
  if (standalone) return null;
  if (justInstalled) {
    if (iconOnly) return null;
    return <p className={clsx("text-sm text-ink-muted", className)}>Installed. Open it from your home screen or apps.</p>;
  }
  return (
    <>
      <Button
        variant={variant}
        icon={Download}
        className={clsx(iconOnly && "px-0", className)}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        onClick={async () => {
          if (canPrompt) {
            const accepted = await promptInstall();
            if (!accepted) setOpen(true);
          } else setOpen(true);
        }}
      >
        {!iconOnly && label}
      </Button>
      <InstallDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function InstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const platform = detectPlatform();
  return (
    <Dialog open={open} onClose={onClose} title={`Install ${APP_NAME}`}>
      <div className="space-y-5">
        <div className="flex justify-center">
          <Logo variant="vertical" className="h-28" decorative />
        </div>
        <p className="text-center text-sm text-ink-muted">An icon on your home screen, a full-screen window, and pages that open even when you're offline.</p>
        <InstallSteps platform={platform} />
        <p className="text-xs text-ink-muted">Free, takes almost no storage, and updates itself. No app store needed.</p>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const DISMISS_KEY = "chapterr:install-banner-dismissed";
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

/** A quiet, dismissible invitation to install, shown on phones and wherever the browser supports one-tap install. */
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
    <div role="region" aria-label="Install the app" className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
      <img src="/icons/icon-192.png" alt="" width={36} height={36} className="size-9 rounded-[8px]" />
      <p className="min-w-0 flex-1 text-sm leading-snug">
        <strong>Add {APP_NAME} to your home screen</strong>
        <span className="hidden text-ink-muted sm:inline">. Opens like an app, works offline.</span>
      </p>
      <InstallAppButton variant="primary" label="Install" className="h-9 px-3 text-sm" />
      <button type="button" onClick={dismiss} aria-label="Not now" title="Not now" className="rounded-control p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
