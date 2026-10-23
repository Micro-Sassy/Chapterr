import clsx from "clsx";
import { BookOpen } from "lucide-react";
import { useState } from "react";
import { coverSrc } from "@/lib/covers";

const sizes = { xs: "w-8 h-12", sm: "w-12 h-18", md: "w-20 h-30", lg: "w-32 h-48" };

/** Book covers: 1px Thread border, 4px radius, never reflections (§5). */
export function BookCover({ url, title, size = "sm", className }: { url: string | null; title: string; size?: keyof typeof sizes; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = coverSrc(url);
  if (!src || failed) {
    return (
      <div
        aria-hidden
        title={title}
        className={clsx(
          // A plain cloth binding: Forest board with a Brass title band, like the mark's spines.
          "relative flex shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-line bg-primary text-on-primary/80",
          "before:absolute before:inset-x-0 before:top-[12%] before:h-[6%] before:bg-accent",
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
      src={src}
      alt={`Cover of ${title}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={clsx("shrink-0 rounded-[4px] border border-line bg-surface-2 object-cover", sizes[size], className)}
    />
  );
}
