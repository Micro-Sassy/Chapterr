import type { PushPublicKey } from "@shared/types";
import { api } from "./api";

export type PushPermission = "granted" | "denied" | "default" | "unsupported";

/** Web Push needs a service worker, the Push API and Notifications. iOS requires the installed app. */
export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function pushPermission(): PushPermission {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

/** VAPID public keys arrive base64url-encoded; PushManager wants raw bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("The app's service worker is not ready yet. Reload and try again.")), 10_000));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

/** The subscription this browser holds, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await registration();
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

function subscriptionBody(sub: PushSubscription) {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : null,
  };
}

/**
 * Ask for permission, subscribe with the server's VAPID key and register the
 * subscription. Resolves to the resulting permission state.
 */
export async function subscribeToPush(): Promise<PushPermission> {
  if (!isPushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const { publicKey } = await api<PushPublicKey>("/api/push/public-key");
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  }
  await api("/api/push/subscribe", { method: "POST", body: subscriptionBody(sub) });
  return "granted";
}

/** Drop this browser's subscription locally and on the server. */
export async function unsubscribeFromPush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => undefined);
  await api("/api/push/subscribe", { method: "DELETE", body: { endpoint } }).catch(() => undefined);
}
