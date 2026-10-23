import { z } from "zod";
import { WAVE2_LIMITS } from "../../shared/constants";
import type { GuideSection } from "../../shared/types-chat";
import type { Env } from "../env";
import { ApiError } from "./errors";

/**
 * Optional AI discussion guide via the Claude Messages API. Only runs when the
 * ANTHROPIC_API_KEY secret is set; without it callers get 409 ai_unavailable
 * and should fall back to the template guide (worker/lib/prompts.ts).
 */

export const AI_MODEL = "claude-sonnet-5";
const API_URL = "https://api.anthropic.com/v1/messages";

export interface AiGuideInput {
  title: string;
  authors: string[];
  description: string | null;
  genres: string[];
  chapters: number | null;
}

export const aiUnavailable = () => new ApiError(409, "ai_unavailable", "AI guides need an API key; the template guide works without one.");
export const aiFailed = () => new ApiError(502, "ai_failed", "The AI guide could not be generated right now. Try the template guide, or try again later.");

const SYSTEM_PROMPT = `You write discussion guides for book clubs. Reply with JSON only, no prose and no code fences, in exactly this shape:
{"sections":[{"title":"Before you start","questions":["..."]},{"title":"While reading","questions":["..."]},{"title":"At the end","questions":["..."]},{"title":"Beyond the book","questions":["..."]}]}
Rules: 12 to 18 questions in total; each question is one sentence, under 300 characters, open-ended and specific to this book. The "Before you start" section must contain no spoilers of any kind (no plot events, twists, endings or late-arriving characters). "While reading" may reference early and middle events, in order. "At the end" may discuss the whole book. "Beyond the book" connects the book to the readers' lives, other books or the wider world. Use plain, warm language. Do not use em dashes.`;

const responseSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        questions: z.array(z.string().trim().min(1).max(500)).min(1).max(WAVE2_LIMITS.guideQuestionsMax),
      }),
    )
    .min(1)
    .max(10),
});

function apiKey(env: Env): string | undefined {
  return (env as Partial<Record<"ANTHROPIC_API_KEY", string>>).ANTHROPIC_API_KEY?.trim() || undefined;
}

export function aiAvailable(env: Env): boolean {
  return !!apiKey(env);
}

function userPrompt(input: AiGuideInput): string {
  const parts = [`Title: ${input.title}`, `Author(s): ${input.authors.join(", ") || "unknown"}`];
  if (input.genres.length) parts.push(`Club genre tags: ${input.genres.join(", ")}`);
  if (input.chapters) parts.push(`The book has ${input.chapters} chapters; in "While reading", prefix each question with the chapter range it belongs to, e.g. "Chapters 1 to 4:".`);
  if (input.description) parts.push(`Publisher description: ${input.description.slice(0, 2000)}`);
  return parts.join("\n");
}

/** Strip code fences and anything before the first `{` / after the last `}` so a slightly chatty reply still parses. */
export function extractJson(text: string): string {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  return start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 500);

/** Parse and validate the model's reply into guide sections (ids ai1..aiN, no room mapping). Throws aiFailed on anything unexpected. */
export function parseGuideResponse(text: string): GuideSection[] {
  let raw: unknown;
  try {
    raw = JSON.parse(extractJson(text));
  } catch {
    throw aiFailed();
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw aiFailed();
  let n = 0;
  let total = 0;
  const sections: GuideSection[] = [];
  for (const s of parsed.data.sections) {
    const questions = [];
    for (const q of s.questions) {
      if (total >= WAVE2_LIMITS.guideQuestionsMax) break;
      questions.push({ id: `ai${++n}`, text: oneLine(q), roomId: null });
      total++;
    }
    if (questions.length) sections.push({ title: oneLine(s.title).slice(0, 120), questions });
  }
  if (sections.length === 0) throw aiFailed();
  return sections;
}

export async function generateGuideWithAi(env: Env, input: AiGuideInput): Promise<GuideSection[]> {
  const key = apiKey(env);
  if (!key) throw aiUnavailable();
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt(input) }],
      }),
    });
  } catch {
    throw aiFailed();
  }
  if (!res.ok) throw aiFailed();
  let body: { content?: { type?: string; text?: string }[] };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw aiFailed();
  }
  const text = body.content?.find((c) => c.type === "text" && typeof c.text === "string")?.text;
  if (!text) throw aiFailed();
  return parseGuideResponse(text);
}
