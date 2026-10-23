import clsx from "clsx";
import { useEffect, useState } from "react";
import { APP_NAME } from "@shared/constants";

type Variant = "horizontal" | "vertical" | "mark" | "wordmark";

const BASE = "/brand/chapterr";
const file = (variant: Variant, ground: "light" | "dark") => `${BASE}/${variant === "mark" || variant === "wordmark" ? variant : `logo-${variant}`}-color-on-${ground}.svg`;

/** The forced theme (data-theme on <html>), if any. */
function useForcedTheme(): "light" | "dark" | null {
  const read = () => {
    const t = typeof document === "undefined" ? null : document.documentElement.dataset.theme;
    return t === "light" || t === "dark" ? t : null;
  };
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/**
 * The Chapterr lockups. Uses the supplied SVGs (never redrawn): colour-on-light by
 * default, swapping to colour-on-dark in dark mode via <picture>, or explicitly
 * when a theme is forced with data-theme.
 */
export function Logo({ variant = "horizontal", className, decorative = false }: { variant?: Variant; className?: string; decorative?: boolean }) {
  const forced = useForcedTheme();
  const alt = decorative ? "" : APP_NAME;
  const imgClass = clsx("block h-auto w-auto select-none", className);
  if (forced) {
    return <img src={file(variant, forced)} alt={alt} className={imgClass} draggable={false} />;
  }
  return (
    <picture className="contents">
      <source srcSet={file(variant, "dark")} media="(prefers-color-scheme: dark)" />
      <img src={file(variant, "light")} alt={alt} className={imgClass} draggable={false} />
    </picture>
  );
}
