import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useConfig } from "@/lib/config";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null;
        reject(new Error("Turnstile failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export interface TurnstileHandle {
  reset: () => void;
}

/**
 * Cloudflare Turnstile widget. The token it produces is single-use and is
 * verified by the Worker; call reset() after each submission.
 */
export const Turnstile = forwardRef<TurnstileHandle, { onToken: (token: string | null) => void; action?: string }>(function Turnstile({ onToken, action }, ref) {
  const { data: config } = useConfig();
  const el = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useImperativeHandle(ref, () => ({
    reset: () => {
      cb.current(null);
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    const siteKey = config?.turnstileSiteKey;
    if (!siteKey || !el.current) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !el.current || !window.turnstile || widgetId.current) return;
        widgetId.current = window.turnstile.render(el.current, {
          sitekey: siteKey,
          action,
          theme: "auto",
          callback: (token: string) => cb.current(token),
          "expired-callback": () => cb.current(null),
          "error-callback": () => cb.current(null),
        });
      })
      .catch(() => cb.current(null));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [config?.turnstileSiteKey, action]);

  return <div ref={el} className="min-h-[65px]" data-testid="turnstile" />;
});
