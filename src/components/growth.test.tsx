import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ClubWrapped, MonthlyRecap } from "@shared/types";
import { checkAccent, contrastRatio } from "@/lib/branding";
import { cleanOcrText } from "@/lib/ocr";
import { urlBase64ToUint8Array } from "@/lib/push";
import { parseInviteCsv, splitCsvLine, toInviteCsv } from "./growth/csv";
import { checkPhone, formatPhone } from "./growth/phone";
import { buildStreakStrip, currentStreak, streakChipText } from "./growth/streak";
import { StreakStrip } from "./growth/StreakStrip";
import { drawClubWrapped, drawMonthlyRecap, SQUARE, STORY, wrapText, type DrawContext } from "./recap/canvas";

describe("bulk invite CSV preview", () => {
  it("splits quoted cells and alternative separators", () => {
    expect(splitCsvLine('jane@example.com,"Doe, Jane"')).toEqual(["jane@example.com", "Doe, Jane"]);
    expect(splitCsvLine("sam@example.com\tSam")).toEqual(["sam@example.com", "Sam"]);
    expect(splitCsvLine('a@b.co;"He said ""hi"""')).toEqual(["a@b.co", 'He said "hi"']);
  });

  it("flags invalid rows and duplicates, skips a header and blank lines", () => {
    const text = ["Email,Name", "jane@example.com, Jane Doe", "", "not-an-email, Nobody", "Sam Smith, sam@example.com", "JANE@example.com", ",", "<lee@example.com>"].join("\n");
    const p = parseInviteCsv(text);
    expect(p.hadHeader).toBe(true);
    expect(p.rows).toHaveLength(6);
    expect(p.rows[0]).toMatchObject({ row: 2, email: "jane@example.com", name: "Jane Doe", valid: true });
    expect(p.rows[1]).toMatchObject({ row: 4, valid: false, reason: "Not a valid email address" });
    expect(p.rows[2]).toMatchObject({ email: "sam@example.com", name: "Sam Smith", valid: true });
    expect(p.rows[3]).toMatchObject({ email: "jane@example.com", valid: false, reason: "Repeated in this list" });
    expect(p.rows[4]).toMatchObject({ valid: false, reason: "No email address" });
    expect(p.rows[5]).toMatchObject({ email: "lee@example.com", valid: true });
    expect(p.valid).toBe(3);
    expect(p.invalid).toBe(3);
    expect(p.duplicates).toBe(1);
    expect(p.tooMany).toBe(false);
    expect(toInviteCsv(p)).toBe("jane@example.com,Jane Doe\nsam@example.com,Sam Smith\nlee@example.com");
  });

  it("marks lists over the batch limit", () => {
    const text = Array.from({ length: 201 }, (_, i) => `m${i}@example.com`).join("\n");
    expect(parseInviteCsv(text).tooMany).toBe(true);
  });
});

describe("phone validation copy", () => {
  it("normalises spaces, dashes and 00 prefixes to E.164", () => {
    expect(checkPhone("+1 (214) 555-1234")).toEqual({ ok: true, normalized: "+12145551234", message: null });
    expect(checkPhone("0044 20 7946 0958").normalized).toBe("+442079460958");
    expect(checkPhone("   ")).toEqual({ ok: true, normalized: "", message: null });
  });

  it("explains what to fix in one sentence", () => {
    expect(checkPhone("214 555 1234").message).toMatch(/country code/);
    expect(checkPhone("+1 214 555 ABCD").message).toMatch(/digits only/);
    expect(checkPhone("+0 123456789").message).toMatch(/cannot start with 0/);
    expect(checkPhone("+1 234").message).toMatch(/too short/);
    expect(checkPhone("+1234567890123456").message).toMatch(/too long/);
    for (const bad of ["214 555 1234", "+1 234"]) expect(checkPhone(bad).message).not.toMatch(/!/);
  });

  it("formats US numbers for display", () => {
    expect(formatPhone("+12145551234")).toBe("+1 214 555 1234");
    expect(formatPhone(null)).toBe("");
  });
});

describe("streak strip", () => {
  const entries = [
    { day: "2026-10-21", pages: 10, minutes: 0 },
    { day: "2026-10-22", pages: 0, minutes: 25 },
    { day: "2026-10-23", pages: 70, minutes: 0 },
    { day: "2026-01-01", pages: 99, minutes: 0 },
  ];

  it("lays out full Monday-to-Sunday weeks ending with the current week", () => {
    const strip = buildStreakStrip(entries, "2026-10-23", 12); // a Friday
    expect(strip.weeks).toHaveLength(12);
    expect(strip.weeks.every((w) => w.length === 7)).toBe(true);
    expect(strip.to).toBe("2026-10-25");
    expect(strip.from).toBe("2026-08-03");
    const last = strip.weeks[11]!;
    expect(last[0]!.day).toBe("2026-10-19");
    expect(last[4]).toMatchObject({ day: "2026-10-23", level: 3, isToday: true });
    expect(last[3]!.level).toBe(2);
    expect(last[2]!.level).toBe(1);
    expect(last[5]!.future).toBe(true);
    expect(strip.daysLogged).toBe(3);
  });

  it("counts the current run and words the home chip", () => {
    expect(currentStreak(entries, "2026-10-23")).toBe(3);
    expect(currentStreak(entries, "2026-10-24")).toBe(3);
    expect(currentStreak(entries, "2026-10-25")).toBe(0);
    expect(streakChipText({ current: 3, today: false })).toBe("3-day streak, log today");
    expect(streakChipText({ current: 3, today: true })).toBe("3-day streak, logged today");
    expect(streakChipText({ current: 0, today: false })).toBe("Start a streak: log today");
  });

  it("renders 84 cells with levels and an accessible summary", () => {
    render(<StreakStrip entries={entries} today="2026-10-23" />);
    const strip = screen.getByTestId("streak-strip");
    expect(strip).toHaveAttribute("aria-label", "3 reading days in the last 12 weeks");
    expect(strip.querySelectorAll("[data-day]")).toHaveLength(84);
    expect(strip.querySelector('[data-day="2026-10-23"]')).toHaveAttribute("data-level", "3");
  });
});

describe("recap canvas builder", () => {
  function recorder() {
    const calls: { op: string; args: unknown[] }[] = [];
    const record = (op: string) => (...args: unknown[]) => void calls.push({ op, args });
    const ctx: DrawContext = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      globalAlpha: 1,
      fillRect: record("fillRect"),
      fillText: record("fillText"),
      measureText: (t: string) => ({ width: t.length * 20 }),
      beginPath: record("beginPath"),
      moveTo: record("moveTo"),
      lineTo: record("lineTo"),
      closePath: record("closePath"),
      fill: record("fill"),
      stroke: record("stroke"),
      save: record("save"),
      restore: record("restore"),
      translate: record("translate"),
      rotate: record("rotate"),
      drawImage: record("drawImage"),
    };
    return { ctx, calls, texts: () => calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0])) };
  }
  const edition = { id: "e1", bookId: "b1", title: "Dune", subtitle: null, authors: ["Frank Herbert"], coverUrl: null, isbn13: null, publishedYear: 1965, format: "paperback" as const, pageCount: 400 };
  const recap: MonthlyRecap = {
    period: "2026-10",
    scope: "user",
    booksFinished: [{ edition, by: null }],
    pagesRead: 1234,
    minutesRead: 600,
    streakBest: 9,
    topGenre: "Science fiction",
    meetingsAttended: 2,
    quotesSaved: 4,
    reviewsWritten: 1,
    headline: "One book finished and a nine-day streak.",
  };

  it("paints the full square with Linen and writes every number", () => {
    const r = recorder();
    drawMonthlyRecap(r.ctx, recap, { subject: "Tyler" }, SQUARE);
    const first = r.calls.find((c) => c.op === "fillRect");
    expect(first?.args).toEqual([0, 0, 1080, 1080]);
    const texts = r.texts();
    expect(texts.some((t) => t.includes("One book finished"))).toBe(true);
    expect(texts).toContain("1,234");
    expect(texts).toContain("9");
    expect(texts).toContain("Most read: Science fiction");
    expect(texts.some((t) => /tyler/i.test(t))).toBe(true);
    expect(texts.join(" ")).not.toMatch(/!/);
    // Spines fallback when there are no cover images: 14° lean.
    expect(r.calls.some((c) => c.op === "rotate" && Math.abs((c.args[0] as number) - (14 * Math.PI) / 180) < 1e-9)).toBe(true);
  });

  it("uses the club accent for the shelf and wraps long headlines", () => {
    const r = recorder();
    drawMonthlyRecap(r.ctx, { ...recap, headline: "word ".repeat(60).trim() }, { subject: "Teel Ridge", accent: "#3F5F8A" }, SQUARE);
    const headlineLines = r.texts().filter((t) => t.startsWith("word"));
    expect(headlineLines.length).toBeLessThanOrEqual(3);
    expect(headlineLines[headlineLines.length - 1]).toMatch(/…$/);
  });

  it("wrapText returns the line count and truncates with an ellipsis", () => {
    const r = recorder();
    expect(wrapText(r.ctx, "a b c d e f g h i j k l m n o p", 0, 0, 100, 10, 2)).toBe(2);
    expect(r.texts()[1]).toMatch(/…$/);
  });

  it("draws Club Wrapped in story and square sizes", () => {
    const member = { id: "u1", username: "ann", displayName: "Ann", avatarUrl: null };
    const w: ClubWrapped = {
      year: 2026,
      clubName: "Teel Ridge",
      booksRead: [edition, edition],
      pagesRead: 5000,
      meetings: 11,
      attendanceRate: 0.82,
      mostLovedBook: { edition, loved: 7 },
      topReviewer: { member, reviews: 9 },
      longestStreak: { member, days: 40 },
      busiestMonth: { month: "2026-03", messages: 412 },
      mostReacted: null,
      polls: { held: 5, votesCast: 44 },
      members: 12,
    };
    for (const size of [STORY, SQUARE]) {
      const r = recorder();
      drawClubWrapped(r.ctx, w, { accent: null }, size);
      expect(r.calls[0]).toEqual({ op: "fillRect", args: [0, 0, size.width, size.height] });
      const texts = r.texts();
      expect(texts).toContain("5,000");
      expect(texts).toContain("82%");
      expect(texts.some((t) => t.includes("Dune"))).toBe(true);
      expect(texts.some((t) => t.includes("Ann"))).toBe(true);
    }
  });
});

describe("branding contrast", () => {
  it("matches the brand book ratios", () => {
    expect(contrastRatio("#1E3A2F", "#F4EEE2")).toBeCloseTo(10.9, 0);
    expect(contrastRatio("#B8903F", "#F4EEE2")).toBeCloseTo(2.6, 1);
  });
  it("summarises where an accent reads", () => {
    expect(checkAccent("#B8903F")).toMatchObject({ linenOk: true, forestOk: true });
    expect(checkAccent("#F0E6D2").summary).toMatch(/dark grounds only/);
    expect(checkAccent("#1E3A2F").summary).toMatch(/light grounds only/);
  });
});

describe("push and OCR helpers", () => {
  it("decodes base64url VAPID keys", () => {
    const bytes = urlBase64ToUint8Array("AQID_-8");
    expect(Array.from(bytes)).toEqual([1, 2, 3, 255, 239]);
  });
  it("tidies OCR line breaks", () => {
    const raw = "It was the best of\ntimes, it was the worst of\ntimes, it was the age of wis-\ndom.\n\nIt was the epoch of belief.";
    expect(cleanOcrText(raw)).toBe("It was the best of times, it was the worst of times, it was the age of wisdom.\n\nIt was the epoch of belief.");
  });
});
