import { RefreshCw } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "./ui";

/** Shown when a new version of the app has been downloaded by the service worker. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for updates every hour while the app is open.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });

  if (!needRefresh && !offlineReady) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-3 border-b border-line bg-accent-soft px-4 py-2 text-sm">
      {needRefresh ? (
        <>
          <span>A new version of the app is available.</span>
          <Button size="sm" icon={RefreshCw} onClick={() => void updateServiceWorker(true)}>
            Update now
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
            Later
          </Button>
        </>
      ) : (
        <>
          <span>The app is ready to open offline.</span>
          <Button size="sm" variant="ghost" onClick={() => setOfflineReady(false)}>
            OK
          </Button>
        </>
      )}
    </div>
  );
}
