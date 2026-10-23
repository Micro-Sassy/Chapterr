import { useEffect, type CSSProperties } from "react";

/** Brand palette (brand book §3.1). */
export const LINEN = "#F4EEE2";
export const FOREST = "#1E3A2F";
export const BRASS = "#B8903F";

export const isHexColor = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);

export function hexToRgb(hex: string): [number, number, number] | null {
  if (!isHexColor(hex)) return null;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Minimum contrast for an accent used as a fill (never as text). Brass on Linen measures 2.56:1. */
export const DECORATIVE_FLOOR = 2.5;

export interface AccentCheck {
  onLinen: number;
  onForest: number;
  /** 2.5:1 is the floor we use for decorative fills (bands, badges, progress); text never uses the accent. Brass on Linen sits right at it. */
  linenOk: boolean;
  forestOk: boolean;
  /** Which brand ground the accent reads best against. */
  bestGround: "linen" | "forest";
  summary: string;
}

/** How a club's accent colour fares against the two brand grounds. */
export function checkAccent(hex: string): AccentCheck {
  const onLinen = contrastRatio(hex, LINEN);
  const onForest = contrastRatio(hex, FOREST);
  const linenOk = onLinen >= DECORATIVE_FLOOR;
  const forestOk = onForest >= DECORATIVE_FLOOR;
  const bestGround = onLinen >= onForest ? "linen" : "forest";
  let summary: string;
  if (linenOk && forestOk) summary = "Reads well on both light and dark surfaces.";
  else if (linenOk) summary = "Reads well on light surfaces. Too close to Forest for dark mode; we will use it on light grounds only.";
  else if (forestOk) summary = "Reads well on dark surfaces. Too light for Linen; we will use it on dark grounds only.";
  else summary = "Low contrast on both grounds. Pick a deeper or brighter shade so bands and badges stay visible.";
  return { onLinen, onForest, linenOk, forestOk, bestGround, summary };
}

export const CLUB_ACCENT_VAR = "--club-accent";

/** Inline style that sets the club accent on a layout root. */
export function clubAccentStyle(accent: string | null | undefined): CSSProperties | undefined {
  if (!accent || !isHexColor(accent)) return undefined;
  return { [CLUB_ACCENT_VAR]: accent } as CSSProperties;
}

/**
 * Apply a club's accent colour as `--club-accent` on a root element (the club
 * layout root when one is given, else the document root), and clear it on unmount
 * or when the accent is removed. Components can then use
 * `var(--club-accent, var(--color-accent))` to pick the club accent with a brand fallback.
 *
 * Intended for ClubLayout: `useClubAccent(club.branding?.accentColor ?? null)`.
 */
export function useClubAccent(accent: string | null | undefined, root?: HTMLElement | null) {
  useEffect(() => {
    const el = root ?? (typeof document !== "undefined" ? document.documentElement : null);
    if (!el) return;
    if (accent && isHexColor(accent)) el.style.setProperty(CLUB_ACCENT_VAR, accent);
    else el.style.removeProperty(CLUB_ACCENT_VAR);
    return () => {
      el.style.removeProperty(CLUB_ACCENT_VAR);
    };
  }, [accent, root]);
}
