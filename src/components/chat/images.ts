import type { FileRecord } from "@shared/types";
import { ApiRequestError } from "@/lib/api";

export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.85;

/**
 * Shrink a photo on the device before upload: longest edge at most 1600px,
 * encoded as JPEG at 85%. Files that cannot be decoded (or are already small
 * and not huge in bytes) are sent as they are.
 */
export async function resizeImage(file: File): Promise<Blob> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  if (scale === 1 && file.size < 600_000 && file.type === "image/jpeg") {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  return blob ?? file;
}

/** Target dimensions after `resizeImage`, used for optimistic layout. */
export function scaledSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Multipart upload of one chat attachment with progress (fetch cannot report
 * upload progress, so this uses XMLHttpRequest). Resolves to the stored file.
 */
export function uploadAttachment(clubId: string, blob: Blob, name: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<FileRecord> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("kind", "attachment");
    form.append("title", name.replace(/\.[a-z0-9]+$/i, "").slice(0, 120) || "Photo");
    form.append("file", blob, blob.type === "image/jpeg" ? name.replace(/\.[a-z0-9]+$/i, "") + ".jpg" : name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/clubs/${encodeURIComponent(clubId)}/files`);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiRequestError(0, "offline", navigator.onLine ? "Could not reach the server. Please try again." : "You are offline."));
    xhr.onabort = () => reject(new DOMException("Upload canceled", "AbortError"));
    xhr.onload = () => {
      const data: unknown = (() => {
        try {
          return xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          return null;
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve(data as FileRecord);
        return;
      }
      const env = (data ?? {}) as { error?: { code?: string; message?: string } };
      reject(new ApiRequestError(xhr.status, env.error?.code ?? "upload_failed", env.error?.message ?? `Upload failed (${xhr.status})`));
    };
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}
