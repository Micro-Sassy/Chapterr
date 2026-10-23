// Text capture from a photo with tesseract.js, loaded only when a member asks for it.
// The worker script and the WebAssembly core ship inside our bundle (same origin, so
// the CSP's worker-src 'self' holds); only the English language data comes from the CDN.
import coreLstmUrl from "tesseract.js-core/tesseract-core-lstm.wasm.js?url";
import coreSimdLstmUrl from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";
import workerUrl from "tesseract.js/dist/worker.min.js?url";

export const OCR_LANG_PATH = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int";

export interface OcrProgress {
  /** 0..1 across loading and recognising. */
  fraction: number;
  /** Short status for the progress bar, in our own words. */
  label: string;
}

/** OCR needs Web Workers and WebAssembly. */
export function isOcrSupported(): boolean {
  return typeof Worker !== "undefined" && typeof WebAssembly === "object" && typeof WebAssembly.validate === "function";
}

// A one-instruction SIMD module: valid only where the engine supports v128.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

function supportsSimd(): boolean {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

const STATUS_LABELS: Record<string, string> = {
  "loading tesseract core": "Preparing the reader",
  "initializing tesseract": "Preparing the reader",
  "loading language traineddata": "Fetching English letterforms",
  "loaded language traineddata": "Fetching English letterforms",
  "initializing api": "Almost ready",
  "recognizing text": "Reading the page",
};

/**
 * Recognise text in an image. Downscales very large photos first (OCR does not
 * need more than ~2000px and the worker is happier with less).
 */
export async function recognizeText(image: Blob, onProgress?: (p: OcrProgress) => void): Promise<string> {
  if (!isOcrSupported()) throw new Error("This browser cannot read text from photos. Type the quotation instead.");
  const { createWorker } = await import("tesseract.js");
  const prepared = await downscale(image, 2000);
  const worker = await createWorker("eng", 1, {
    workerPath: workerUrl,
    corePath: supportsSimd() ? coreSimdLstmUrl : coreLstmUrl,
    langPath: OCR_LANG_PATH,
    workerBlobURL: false,
    logger: (m: { status?: string; progress?: number }) => {
      if (!onProgress || !m.status) return;
      const label = STATUS_LABELS[m.status] ?? "Working";
      const p = typeof m.progress === "number" ? m.progress : 0;
      // Loading takes the first 40%, recognition the rest.
      const fraction = m.status === "recognizing text" ? 0.4 + p * 0.6 : Math.min(0.4, p * 0.4);
      onProgress({ fraction, label });
    },
  });
  try {
    const result = await worker.recognize(prepared);
    return result.data.text ?? "";
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

async function downscale(image: Blob, maxEdge: number): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return image;
  try {
    const bitmap = await createImageBitmap(image);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) {
      bitmap.close?.();
      return image;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return image;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    return blob ?? image;
  } catch {
    return image;
  }
}

/**
 * Tidy OCR output for a quotation: join lines broken by the page's measure,
 * keep paragraph breaks, fix hyphenation at line ends and straighten stray spaces.
 */
export function cleanOcrText(raw: string): string {
  const paragraphs = raw
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((para) =>
      para
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .reduce((acc, line) => {
          if (!acc) return line;
          if (/[A-Za-z]-$/.test(acc)) return acc.slice(0, -1) + line;
          return `${acc} ${line}`;
        }, ""),
    )
    .filter(Boolean);
  return paragraphs
    .join("\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\|/g, "I")
    .trim();
}
