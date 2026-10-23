import { ApiRequestError } from "./api";

export interface UploadOptions {
  /** Extra form fields sent alongside the file. Empty strings and nulls are skipped. */
  fields?: Record<string, string | null | undefined>;
  /** 0..1 as the browser sends the body. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  method?: "POST" | "PUT";
  /** Name of the multipart field carrying the file. */
  fieldName?: string;
}

/**
 * Multipart upload to our own API with progress. Uses XMLHttpRequest because
 * fetch has no upload progress events. Errors follow the same envelope as api().
 */
export function uploadFile<T>(path: string, file: Blob, opts: UploadOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(opts.fields ?? {})) if (v != null && v !== "") form.append(k, v);
    const name = file instanceof File ? file.name : "upload";
    form.append(opts.fieldName ?? "file", file, name);

    const xhr = new XMLHttpRequest();
    xhr.open(opts.method ?? "POST", path);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    xhr.responseType = "text";
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && opts.onProgress) opts.onProgress(Math.min(1, ev.loaded / ev.total));
    };
    xhr.onerror = () => reject(new ApiRequestError(0, "offline", navigator.onLine ? "Could not reach the server. Please try again." : "You are offline."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    xhr.onload = () => {
      let data: unknown = null;
      if (xhr.responseText) {
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = null;
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(1);
        resolve(data as T);
        return;
      }
      const envelope = data as { error?: { code?: string; message?: string; fields?: Record<string, string[]>; current?: unknown } } | null;
      const err = envelope?.error;
      reject(new ApiRequestError(xhr.status, err?.code ?? "error", err?.message ?? `Upload failed (${xhr.status})`, err?.fields, err?.current));
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        reject(new DOMException("Upload cancelled", "AbortError"));
        return;
      }
      opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "image/avif"]);

export const isImageFile = (file: File) => IMAGE_TYPES.has(file.type) || /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(file.name);

/**
 * Resize an image so its longest edge is at most `maxEdge` pixels, re-encoding as
 * WebP (JPEG where WebP is unavailable). Files already small enough, GIFs and
 * anything the browser cannot decode are returned untouched.
 */
export async function resizeImageFile(file: File, maxEdge = 2000, quality = 0.86): Promise<File> {
  if (!isImageFile(file) || file.type === "image/gif") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && (file.type === "image/jpeg" || file.type === "image/webp")) {
    bitmap.close?.();
    return file;
  }
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await encodeCanvas(canvas, quality);
  if (!blob) return file;
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${base}.${ext}`, { type: blob.type, lastModified: file.lastModified });
}

async function encodeCanvas(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  const toBlob = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
  const webp = await toBlob("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  return toBlob("image/jpeg");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
