import { useSyncExternalStore } from "react";

/** Chromium's install prompt event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallPlatform = "ios" | "android" | "mac-safari" | "desktop" | "unsupported";

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Start listening as early as possible: browsers fire `beforeinstallprompt`
 * once, often before React has rendered. Called from main.tsx.
 */
export function listenForInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own "Install app" button instead of the mini-infobar
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    emit();
  });
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", emit);
}

export function detectPlatform(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): InstallPlatform {
  const iPadOs = /Macintosh/.test(ua) && touchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOs) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua)) return "mac-safari";
  if (/Firefox/.test(ua)) return "unsupported";
  return "desktop";
}

interface InstallState {
  /** Running as the installed app. */
  standalone: boolean;
  /** Installed during this visit. */
  justInstalled: boolean;
  /** The browser offered its own one-tap install dialog. */
  canPrompt: boolean;
}

let snapshot: InstallState = { standalone: false, justInstalled: false, canPrompt: false };
function getSnapshot(): InstallState {
  const next = { standalone: isStandalone(), justInstalled: installed, canPrompt: deferred !== null };
  if (next.standalone !== snapshot.standalone || next.justInstalled !== snapshot.justInstalled || next.canPrompt !== snapshot.canPrompt) snapshot = next;
  return snapshot;
}
const serverSnapshot: InstallState = snapshot;

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSnapshot,
    () => serverSnapshot,
  );
}

/** Show the browser's install dialog. Resolves true when the member accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null; // a prompt event can only be used once
  emit();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}
