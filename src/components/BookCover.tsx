import clsx from "clsx";
import { BookOpen } from "lucide-react";
import { useState } from "react";

const sizes = { xs: "w-8 h-12", sm: "w-12 h-18", md: "w-20 h-30", lg: "w-32 h-48" };

export function BookCover({ url, title, size = "sm", className }: { url: string | null; title: string; size?: keyof typeof sizes; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div
        aria-hidden
        className={clsx("flex shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-ink-muted", sizes[size], className)}
        title={title}
      >
        <BookOpen className="size-1/3" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={`Cover of ${title}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={clsx("shrink-0 rounded-md border border-line bg-surface-2 object-cover", sizes[size], className)}
    />
  );
}
