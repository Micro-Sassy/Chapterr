import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { Me, NotificationPreferences, PushPreferences } from "@shared/types";
import { Alert, Badge, Button, Checkbox } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { api, errorMessage } from "@/lib/api";
import { useInstallState } from "@/lib/install";
import { currentSubscription, isPushSupported, pushPermission, subscribeToPush, unsubscribeFromPush, type PushPermission } from "@/lib/push";

export type MergedPreferences = NotificationPreferences & Partial<PushPreferences>;

type PushUiState = "unsupported" | "blocked" | "enabled" | "off" | "checking";

export function usePushState() {
  const [state, setState] = useState<PushUiState>("checking");
  const refresh = async () => {
    if (!isPushSupported()) return setState("unsupported");
    const perm = pushPermission();
    if (perm === "denied") return setState("blocked");
    const sub = await currentSubscription();
    setState(sub && perm === "granted" ? "enabled" : "off");
  };
  useEffect(() => {
    void refresh();
  }, []);
  return { state, refresh };
}

/** Push toggle plus per-kind switches, saved with the rest of the preferences. */
export function PushSettings({ prefs, onChange }: { prefs: MergedPreferences; onChange: (next: Partial<PushPreferences>) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { state, refresh } = usePushState();
  const install = useInstallState();
  const [error, setError] = useState<string | null>(null);

  const savePushEnabled = async (enabled: boolean) => {
    try {
      const me = await api<Me>("/api/account/preferences", { method: "PUT", body: { pushEnabled: enabled } });
      qc.setQueryData(["me"], me);
    } catch {
      /* the subscription itself is what matters; the flag is a hint for the server */
    }
  };

  const enable = useMutation({
    mutationFn: async (): Promise<PushPermission> => {
      setError(null);
      return subscribeToPush();
    },
    onSuccess: async (perm) => {
      await refresh();
      if (perm === "granted") {
        onChange({ pushEnabled: true });
        void savePushEnabled(true);
        toast("Push notifications are on for this device.");
      } else if (perm === "denied") setError("Notifications are blocked for Chapterr in this browser. Allow them in the site settings, then try again.");
      else setError("No permission was given, so nothing changed.");
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const disable = useMutation({
    mutationFn: unsubscribeFromPush,
    onSuccess: async () => {
      await refresh();
      onChange({ pushEnabled: false });
      void savePushEnabled(false);
      toast("Push notifications are off for this device.");
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const iosNeedsInstall = /iPhone|iPad|iPod/.test(navigator.userAgent) && !install.standalone;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-ground p-4">
        {state === "enabled" ? <Bell className="size-5 text-ink-muted" aria-hidden strokeWidth={1.75} /> : <BellOff className="size-5 text-ink-muted" aria-hidden strokeWidth={1.75} />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Push notifications on this device</p>
          <p className="text-xs text-ink-muted">
            {state === "checking" && "Checking this browser."}
            {state === "unsupported" && (iosNeedsInstall ? "On iPhone and iPad, add Chapterr to your Home Screen first; push works from the installed app." : "This browser does not support push notifications.")}
            {state === "blocked" && "Blocked in this browser's site settings."}
            {state === "enabled" && "On. Mentions and reminders arrive even when the app is closed."}
            {state === "off" && "Off. Turn on to hear about mentions and meeting reminders."}
          </p>
        </div>
        <Badge tone={state === "enabled" ? "success" : state === "blocked" ? "error" : "neutral"}>{state === "enabled" ? "Enabled" : state === "blocked" ? "Blocked" : state === "unsupported" ? "Unsupported" : state === "checking" ? "Checking" : "Off"}</Badge>
        {state === "off" && (
          <Button size="sm" icon={Bell} loading={enable.isPending} onClick={() => enable.mutate()}>
            Turn on
          </Button>
        )}
        {state === "enabled" && (
          <Button size="sm" variant="secondary" icon={BellOff} loading={disable.isPending} onClick={() => disable.mutate()}>
            Turn off
          </Button>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="space-y-2">
        <Checkbox label="Mentions in club chat" checked={prefs.pushMentions ?? true} disabled={state !== "enabled"} onChange={(e) => onChange({ pushMentions: e.target.checked })} />
        <Checkbox label="Meeting reminders" checked={prefs.pushMeetingReminders ?? true} disabled={state !== "enabled"} onChange={(e) => onChange({ pushMeetingReminders: e.target.checked })} />
        <p className="text-xs text-ink-muted">Each device you turn push on gets its own subscription. Turning it off here affects this device only.</p>
      </div>
    </div>
  );
}
