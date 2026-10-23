// Shareable graphics drawn client-side from recap JSON (brand book: Linen ground,
// Fraunces headline, Forest ink, one Brass accent, book spines as the motif).
import type { ClubWrapped, MonthlyRecap } from "@shared/types";

export const LINEN = "#F4EEE2";
export const PARCHMENT = "#FBF8F1";
export const THREAD = "#E3DAC6";
export const FOREST = "#1E3A2F";
export const IVY = "#2A4D3F";
export const DEEP_FOREST = "#142A22";
export const BRASS = "#B8903F";
export const MOSS = "#4B5E55";

export const DISPLAY_FONT = '"Fraunces Variable", "Iowan Old Style", Georgia, serif';
export const BODY_FONT = '"Inter Variable", Inter, system-ui, sans-serif';

/** The subset of CanvasRenderingContext2D the builders use, so tests can pass a recorder. */
export interface DrawContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  roundRect?(x: number, y: number, w: number, h: number, radii?: number | number[]): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
}

export interface GraphicSize {
  width: number;
  height: number;
}
export const SQUARE: GraphicSize = { width: 1080, height: 1080 };
export const STORY: GraphicSize = { width: 1080, height: 1920 };

// --- Primitives --------------------------------------------------------------------------------

function roundedRect(ctx: DrawContext, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.lineTo(x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.lineTo(x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.lineTo(x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.closePath();
  }
}

/** Wrap text to a width, returning the lines drawn. */
export function wrapText(ctx: DrawContext, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 4): number {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) {
    const last = lines[maxLines - 1]!;
    let trimmed = last;
    while (trimmed && ctx.measureText(`${trimmed}…`).width > maxWidth) trimmed = trimmed.slice(0, -1).trimEnd();
    lines[maxLines - 1] = `${trimmed}…`;
  }
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return lines.length;
}

/**
 * The Spine Stack motif: `count` book spines on a brass shelf, the last leaning 14°.
 * Spines take the club accent when given, else Forest.
 */
export function drawSpines(ctx: DrawContext, x: number, baseY: number, count: number, scale = 1, ink = FOREST) {
  const n = Math.max(1, Math.min(count, 9));
  const gap = 8 * scale;
  const width = 28 * scale;
  let cx = x;
  for (let i = 0; i < n; i++) {
    const height = (90 + ((i * 37) % 60)) * scale;
    const lean = i === n - 1 && n > 1;
    ctx.save();
    if (lean) {
      ctx.translate(cx + width / 2, baseY);
      ctx.rotate((14 * Math.PI) / 180);
      ctx.translate(-(cx + width / 2), -baseY);
    }
    ctx.fillStyle = ink;
    roundedRect(ctx, cx, baseY - height, width, height, 4 * scale);
    ctx.fill();
    ctx.fillStyle = BRASS;
    ctx.fillRect(cx, baseY - height + 14 * scale, width, 5 * scale);
    ctx.restore();
    cx += width + gap;
  }
  ctx.fillStyle = BRASS;
  roundedRect(ctx, x - 10 * scale, baseY, cx - x + 16 * scale, 6 * scale, 3 * scale);
  ctx.fill();
}

function eyebrow(ctx: DrawContext, text: string, x: number, y: number, color = MOSS) {
  ctx.font = `600 22px ${BODY_FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text.toUpperCase(), x, y);
}

function bigNumber(ctx: DrawContext, value: string, label: string, x: number, y: number, ink: string, muted: string, size = 96) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${size}px ${DISPLAY_FONT}`;
  ctx.fillStyle = ink;
  ctx.fillText(value, x, y);
  ctx.font = `400 26px ${BODY_FONT}`;
  ctx.fillStyle = muted;
  ctx.fillText(label, x, y + 40);
}

function footer(ctx: DrawContext, size: GraphicSize, ink: string, muted: string, right?: string) {
  const y = size.height - 64;
  ctx.font = `600 30px ${DISPLAY_FONT}`;
  ctx.textAlign = "left";
  ctx.fillStyle = ink;
  ctx.fillText("Chapter", 72, y);
  const w = ctx.measureText("Chapter").width;
  ctx.fillStyle = BRASS;
  ctx.fillText("r", 72 + w, y);
  if (right) {
    ctx.font = `400 22px ${BODY_FONT}`;
    ctx.fillStyle = muted;
    ctx.textAlign = "right";
    ctx.fillText(right, size.width - 72, y);
  }
}

export function monthLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const fmt = (n: number) => n.toLocaleString();
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

// --- Monthly recap (1080 x 1080) -----------------------------------------------------------------

export interface RecapGraphicOptions {
  /** Who the recap is about: a member's display name or the club's name. */
  subject: string;
  accent?: string | null;
  covers?: CanvasImageSource[];
}

/** Draw the monthly recap card. Pure drawing; the caller owns the canvas. */
export function drawMonthlyRecap(ctx: DrawContext, recap: MonthlyRecap, opts: RecapGraphicOptions, size: GraphicSize = SQUARE) {
  const { width, height } = size;
  const accent = opts.accent ?? BRASS;
  ctx.globalAlpha = 1;
  ctx.fillStyle = LINEN;
  ctx.fillRect(0, 0, width, height);
  // Parchment panel
  ctx.fillStyle = PARCHMENT;
  roundedRect(ctx, 48, 48, width - 96, height - 96, 40);
  ctx.fill();
  ctx.strokeStyle = THREAD;
  ctx.lineWidth = 2;
  ctx.stroke();

  eyebrow(ctx, `${monthLabel(recap.period)} · ${opts.subject}`, 96, 140);
  ctx.font = `600 64px ${DISPLAY_FONT}`;
  ctx.fillStyle = FOREST;
  ctx.textAlign = "left";
  wrapText(ctx, recap.headline || `${fmt(recap.booksFinished.length)} ${plural(recap.booksFinished.length, "book")} finished.`, 96, 230, width - 192, 74, 3);

  // Numbers grid
  const top = 470;
  bigNumber(ctx, fmt(recap.booksFinished.length), plural(recap.booksFinished.length, "book finished", "books finished"), 96, top, FOREST, MOSS);
  bigNumber(ctx, fmt(recap.pagesRead), "pages read", 420, top, FOREST, MOSS);
  bigNumber(ctx, fmt(recap.streakBest), `${plural(recap.streakBest, "day")} best streak`, 744, top, FOREST, MOSS);
  const row2 = top + 170;
  bigNumber(ctx, fmt(recap.meetingsAttended), plural(recap.meetingsAttended, "meeting attended", "meetings attended"), 96, row2, FOREST, MOSS, 72);
  bigNumber(ctx, fmt(recap.quotesSaved), plural(recap.quotesSaved, "quote saved", "quotes saved"), 420, row2, FOREST, MOSS, 72);
  bigNumber(ctx, fmt(recap.reviewsWritten), plural(recap.reviewsWritten, "review", "reviews"), 744, row2, FOREST, MOSS, 72);

  if (recap.topGenre) {
    ctx.font = `400 26px ${BODY_FONT}`;
    ctx.fillStyle = MOSS;
    ctx.textAlign = "left";
    ctx.fillText(`Most read: ${recap.topGenre}`, 96, row2 + 110);
  }

  // Covers or spines along the bottom
  const shelfY = height - 150;
  if (opts.covers && opts.covers.length) {
    let x = 96;
    for (const img of opts.covers.slice(0, 6)) {
      ctx.save();
      roundedRect(ctx, x, shelfY - 180, 120, 180, 6);
      ctx.fillStyle = THREAD;
      ctx.fill();
      ctx.drawImage(img, x, shelfY - 180, 120, 180);
      ctx.restore();
      x += 136;
    }
    ctx.fillStyle = accent;
    roundedRect(ctx, 86, shelfY, Math.min(width - 172, x - 86), 6, 3);
    ctx.fill();
  } else {
    drawSpines(ctx, 96, shelfY, Math.max(3, recap.booksFinished.length), 1.6, accent === BRASS ? FOREST : accent);
  }
  footer(ctx, size, FOREST, MOSS, "chapterr.io");
}

// --- Club Wrapped (1080 x 1920 story, 1080 x 1080 square) -------------------------------------------

export interface WrappedGraphicOptions {
  accent?: string | null;
  cover?: CanvasImageSource | null;
}

export function drawClubWrapped(ctx: DrawContext, w: ClubWrapped, opts: WrappedGraphicOptions, size: GraphicSize = STORY) {
  const { width, height } = size;
  const story = height > width;
  const accent = opts.accent ?? BRASS;
  ctx.globalAlpha = 1;
  ctx.fillStyle = FOREST;
  ctx.fillRect(0, 0, width, height);
  // Soft Ivy band for depth
  ctx.fillStyle = IVY;
  roundedRect(ctx, 48, story ? 160 : 48, width - 96, story ? height - 320 : height - 96, 40);
  ctx.fill();

  const left = 96;
  const headY = story ? 300 : 150;
  eyebrow(ctx, `${w.clubName} · ${w.year}`, left, headY - 50, "#B9C4BE");
  ctx.font = `600 ${story ? 92 : 72}px ${DISPLAY_FONT}`;
  ctx.fillStyle = LINEN;
  ctx.textAlign = "left";
  ctx.fillText("Our year", left, headY + 50);
  ctx.fillStyle = accent;
  ctx.fillText("in books.", left, headY + 50 + (story ? 100 : 80));

  const ink = LINEN;
  const muted = "#B9C4BE";
  const gridTop = headY + (story ? 330 : 240);
  const colW = (width - 192) / 2;
  bigNumber(ctx, fmt(w.booksRead.length), plural(w.booksRead.length, "book read", "books read"), left, gridTop, ink, muted, story ? 120 : 88);
  bigNumber(ctx, fmt(w.pagesRead), "pages between us", left + colW, gridTop, ink, muted, story ? 120 : 88);
  const row2 = gridTop + (story ? 210 : 160);
  bigNumber(ctx, fmt(w.meetings), plural(w.meetings, "meeting"), left, row2, ink, muted, story ? 120 : 88);
  bigNumber(ctx, w.attendanceRate == null ? "–" : `${Math.round(w.attendanceRate * 100)}%`, "attendance", left + colW, row2, ink, muted, story ? 120 : 88);

  // Highlights
  let y = row2 + (story ? 170 : 120);
  const lineH = story ? 48 : 40;
  ctx.font = `400 ${story ? 30 : 26}px ${BODY_FONT}`;
  const highlight = (label: string, value: string) => {
    if (y > height - (story ? 420 : 240)) return;
    ctx.fillStyle = accent;
    ctx.fillRect(left, y - 22, 6, 28);
    ctx.fillStyle = muted;
    ctx.textAlign = "left";
    ctx.fillText(label, left + 24, y);
    ctx.fillStyle = ink;
    ctx.font = `500 ${story ? 32 : 28}px ${DISPLAY_FONT}`;
    wrapText(ctx, value, left + 24, y + lineH - 8, width - 192 - 24, lineH, 2);
    ctx.font = `400 ${story ? 30 : 26}px ${BODY_FONT}`;
    y += lineH * 2 + 24;
  };
  if (w.mostLovedBook) highlight("Most loved", `${w.mostLovedBook.edition.title} (${w.mostLovedBook.loved} loved it)`);
  if (w.topReviewer) highlight("Top reviewer", `${w.topReviewer.member.displayName}, ${w.topReviewer.reviews} ${plural(w.topReviewer.reviews, "review")}`);
  if (w.longestStreak) highlight("Longest streak", `${w.longestStreak.member.displayName}, ${w.longestStreak.days} ${plural(w.longestStreak.days, "day")}`);
  if (w.busiestMonth) highlight("Busiest month", `${monthLabel(w.busiestMonth.month)}, ${fmt(w.busiestMonth.messages)} messages`);
  if (story && w.polls.held > 0) highlight("Polls", `${w.polls.held} held, ${fmt(w.polls.votesCast)} votes cast`);

  // Cover or spines
  const shelfY = height - (story ? 300 : 160);
  if (opts.cover) {
    ctx.save();
    roundedRect(ctx, width - 96 - 200, shelfY - 300, 200, 300, 8);
    ctx.fillStyle = THREAD;
    ctx.fill();
    ctx.drawImage(opts.cover, width - 96 - 200, shelfY - 300, 200, 300);
    ctx.restore();
  } else {
    drawSpines(ctx, width - 96 - 260, shelfY, Math.max(2, Math.min(w.booksRead.length, 6)), story ? 1.6 : 1.1, LINEN);
  }
  ctx.font = `400 24px ${BODY_FONT}`;
  ctx.fillStyle = muted;
  ctx.textAlign = "left";
  ctx.fillText(`${w.members} ${plural(w.members, "member")} · Club Wrapped ${w.year}`, left, height - (story ? 180 : 120));
  footer(ctx, size, LINEN, muted, "chapterr.io");
}

// --- Browser plumbing -----------------------------------------------------------------------------

/** Make sure the brand fonts are available to the canvas before drawing. */
export async function ensureFonts(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  try {
    await Promise.all([
      document.fonts.load(`600 64px ${DISPLAY_FONT}`),
      document.fonts.load(`500 32px ${DISPLAY_FONT}`),
      document.fonts.load(`400 26px ${BODY_FONT}`),
      document.fonts.load(`600 22px ${BODY_FONT}`),
    ]);
  } catch {
    /* fall back to the system stack */
  }
}

/** Load a cover through the same-origin proxy for drawing (returns null when it fails). */
export function loadImage(src: string | null | undefined): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function renderToBlob(size: GraphicSize, draw: (ctx: CanvasRenderingContext2D) => void): Promise<Blob> {
  await ensureFonts();
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw the image.");
  draw(ctx);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("Could not create the image.");
  return blob;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function canShareFiles(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function";
}

/** Hand a PNG to the system share sheet. Returns false when sharing is unavailable. */
export async function shareBlob(blob: Blob, filename: string, title: string): Promise<boolean> {
  if (!canShareFiles()) return false;
  const file = new File([blob], filename, { type: "image/png" });
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title });
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return true;
    return false;
  }
}
