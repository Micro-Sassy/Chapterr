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
        title={title}
        className={clsx(
          // A plain cloth binding: green board, gilt rule and a darker spine.
          "relative flex shrink-0 items-center justify-center overflow-hidden rounded-[3px] rounded-l-[2px] bg-accent text-gold shadow-[var(--shadow-book)]",
          "before:absolute before:inset-y-0 before:left-0 before:w-[8%] before:bg-black/20",
          "after:absolute after:inset-[9%] after:left-[16%] after:rounded-[1px] after:border after:border-gold/50",
          sizes[size],
          className,
        )}
      >
        <BookOpen className="relative size-1/3" strokeWidth={1.5} />
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
      className={clsx("shrink-0 rounded-[3px] rounded-l-[2px] bg-surface-2 object-cover shadow-[var(--shadow-book)]", sizes[size], className)}
    />
  );
}
