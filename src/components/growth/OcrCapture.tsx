import { Camera, Check, Eraser, X } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, Button, buttonClass, ProgressBar, Textarea } from "@/components/ui";
import { cleanOcrText, isOcrSupported, recognizeText, type OcrProgress } from "@/lib/ocr";

type Phase = "idle" | "working" | "review" | "failed";

/**
 * "Capture from photo": pick or take a photo of the page, read it on the device,
 * tidy the line breaks and hand the text to the quote field.
 */
export function OcrCapture({ onText }: { onText: (text: string) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<OcrProgress>({ fraction: 0, label: "Preparing the reader" });
  const [raw, setRaw] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const supported = isOcrSupported();

  const start = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPhase("working");
    setProgress({ fraction: 0, label: "Preparing the reader" });
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    try {
      const result = await recognizeText(file, setProgress);
      const trimmed = result.trim();
      if (!trimmed) {
        setError("No text was found in that photo. Try a sharper, well-lit shot with the page filling the frame.");
        setPhase("failed");
        return;
      }
      setRaw(trimmed);
      setText(trimmed);
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error && err.message ? `${err.message} You can still type the quotation.` : "The photo could not be read. Check your connection and try again, or type the quotation.");
      setPhase("failed");
    }
  };

  const reset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setPhase("idle");
    setError(null);
    setRaw("");
    setText("");
  };

  if (!supported) return null;

  if (phase === "idle") {
    return (
      <div>
        <label className={buttonClass("secondary", "sm", "cursor-pointer")}>
          <Camera className="size-4" aria-hidden /> Capture from photo
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              void start(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <p className="mt-1 text-xs text-ink-muted">Photograph the page; the text is read on your device and dropped into the field. English only for now.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-control border border-line bg-ground p-3" aria-live="polite">
      <div className="flex items-start gap-3">
        {preview && <img src={preview} alt="The photo being read" className="h-20 w-16 shrink-0 rounded-[4px] border border-line object-cover" />}
        <div className="min-w-0 flex-1 space-y-2">
          {phase === "working" && (
            <>
              <p className="text-sm font-medium">{progress.label}…</p>
              <ProgressBar value={Math.round(progress.fraction * 100)} max={100} label="Reading the photo" />
              <p className="text-xs text-ink-muted">The first read downloads the English letterforms (about 4 MB); later ones are quicker.</p>
            </>
          )}
          {phase === "failed" && error && <Alert tone="error">{error}</Alert>}
          {phase === "review" && (
            <>
              <p className="text-sm font-medium">Here is what we read. Tidy it, then use it.</p>
              <Textarea aria-label="Text read from the photo" rows={5} value={text} onChange={(e) => setText(e.target.value)} className="text-sm" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={Check} onClick={() => (onText(text.trim()), reset())}>
                  Use text
                </Button>
                <Button size="sm" variant="secondary" icon={Eraser} onClick={() => setText(cleanOcrText(text))} disabled={cleanOcrText(text) === text}>
                  Clean up line breaks
                </Button>
                {text !== raw && (
                  <Button size="sm" variant="ghost" onClick={() => setText(raw)}>
                    Undo clean-up
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
        <Button size="sm" variant="ghost" icon={X} aria-label="Cancel photo capture" onClick={reset} />
      </div>
      {phase === "failed" && (
        <label className={buttonClass("secondary", "sm", "cursor-pointer")}>
          <Camera className="size-4" aria-hidden /> Try another photo
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => (void start(e.target.files?.[0]), (e.target.value = ""))} />
        </label>
      )}
    </div>
  );
}
