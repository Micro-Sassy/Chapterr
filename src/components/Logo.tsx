import clsx from "clsx";

type Variant = "horizontal" | "stacked" | "mark";

const files: Record<Variant, { green: string; cream: string; w: number; h: number }> = {
  horizontal: { green: "/brand/logo-horizontal-green.png", cream: "/brand/logo-horizontal-cream.png", w: 1200, h: 223 },
  stacked: { green: "/brand/logo-stacked-green.png", cream: "/brand/logo-stacked-cream.png", w: 720, h: 444 },
  mark: { green: "/brand/mark-green.png", cream: "/brand/mark-cream.png", w: 512, h: 249 },
};

/** The Teel Ridge Book Club logo in forest-green ink, switching to cream in dark mode. */
export function Logo({ variant = "horizontal", className, decorative = false }: { variant?: Variant; className?: string; decorative?: boolean }) {
  const f = files[variant];
  return (
    <picture>
      <source srcSet={f.cream} media="(prefers-color-scheme: dark)" />
      <img
        src={f.green}
        width={f.w}
        height={f.h}
        alt={decorative ? "" : "Teel Ridge Book Club"}
        className={clsx("h-auto select-none", className)}
        draggable={false}
      />
    </picture>
  );
}
