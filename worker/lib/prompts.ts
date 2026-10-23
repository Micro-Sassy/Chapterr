import type { GateType, RoomKind } from "../../shared/constants";
import type { GuideQuestion, GuideSection } from "../../shared/types-chat";

/**
 * Template discussion guides: deterministic, no AI. The same book, genres and
 * rooms always produce the same guide. Genre flavour comes from the club's
 * genre tags on the book plus keywords in the title and description; the
 * title and first author are woven into the questions.
 */

export interface TemplateRoom {
  id: string;
  kind: RoomKind;
  gateType: GateType;
  gateValue: number | null;
}

export interface TemplateInput {
  title: string;
  authors: string[];
  description: string | null;
  genres: string[];
  chapters: number | null;
  rooms: TemplateRoom[];
}

type Flavor = "mystery" | "romance" | "fantasy" | "scifi" | "historical" | "nonfiction" | "memoir" | "horror" | "literary" | "young_adult" | "classic";

const FLAVOR_KEYWORDS: Record<Flavor, string[]> = {
  mystery: ["mystery", "thriller", "crime", "detective", "suspense", "murder", "noir", "whodunit"],
  romance: ["romance", "love story", "romantic", "rom-com", "romcom"],
  fantasy: ["fantasy", "magic", "dragon", "kingdom", "sorcer", "witch", "fae", "quest"],
  scifi: ["science fiction", "sci-fi", "scifi", "space", "dystopia", "robot", "future", "alien", "speculative"],
  historical: ["historical", "history", "war", "century", "victorian", "medieval", "wwii", "world war"],
  nonfiction: ["nonfiction", "non-fiction", "essay", "science", "business", "self-help", "psychology", "economics", "politics", "journalism"],
  memoir: ["memoir", "autobiography", "biography", "life of", "my life", "true story"],
  horror: ["horror", "haunted", "ghost", "gothic", "terror"],
  literary: ["literary", "fiction", "novel", "family", "coming-of-age", "prize", "booker", "pulitzer"],
  young_adult: ["young adult", "ya", "teen", "coming of age", "high school"],
  classic: ["classic", "classics", "penguin", "19th", "18th", "translated"],
};

/** Small stable hash so a title picks the same variant every time. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function detectFlavors(input: Pick<TemplateInput, "title" | "description" | "genres">): Flavor[] {
  const hay = [...input.genres, input.title, input.description ?? ""].join(" ").toLowerCase();
  const genreText = input.genres.join(" ").toLowerCase();
  const found: { flavor: Flavor; score: number }[] = [];
  for (const [flavor, words] of Object.entries(FLAVOR_KEYWORDS) as [Flavor, string[]][]) {
    let score = 0;
    for (const w of words) {
      if (genreText.includes(w)) score += 3;
      else if (new RegExp(`\\b${w.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}`, "i").test(hay)) score += 1;
    }
    if (score > 0) found.push({ flavor, score });
  }
  found.sort((a, b) => b.score - a.score || a.flavor.localeCompare(b.flavor));
  return found.slice(0, 2).map((f) => f.flavor);
}

const BEFORE_GENERAL = [
  "What does the title {title} make you expect, and what do you hope the book delivers?",
  "Have you read anything by {author} before? What do you know about their work going in?",
  "Why do you think the club chose this book, and what would make it a worthwhile pick for you?",
  "Based on the cover and the opening page, what tone are you expecting?",
];
const BEFORE_FLAVOR: Record<Flavor, string[]> = {
  mystery: ["What makes a mystery satisfying for you: a puzzle you can solve, or one that fools you?"],
  romance: ["What kind of romance do you find believable on the page, and what makes you roll your eyes?"],
  fantasy: ["How much world-building do you want up front before the story gets moving?"],
  scifi: ["Do you prefer science fiction that explains its ideas or one that simply lives inside them?"],
  historical: ["What do you already know about the period this book is set in, and what do you hope to learn?"],
  nonfiction: ["What is your current view on this subject? Write it down so you can see whether the book moves it."],
  memoir: ["What do you want from a memoir: honesty, insight, a good story, or something else?"],
  horror: ["What frightens you more in a book: what is shown, or what is left unsaid?"],
  literary: ["Do you read for character, language or plot first? Which do you expect this book to lead with?"],
  young_adult: ["What did you read at that age, and how do you expect this book to compare?"],
  classic: ["Why do you think this book is still read? What might feel dated, and what might feel fresh?"],
};

const WHILE_GENERAL = [
  "Which character do you trust so far, and which one are you keeping an eye on?",
  "Where did the pacing slow or speed up for you, and did that feel deliberate?",
  "Pick one passage you marked. Why did it stop you?",
  "What question do you most want answered by the end of the book?",
  "Has your opinion of the main character changed since the opening chapters?",
  "What is {author} doing with point of view here, and is it working for you?",
  "Which scene would you most want to see dramatised, and why?",
  "What is the book quietly saying about the world its characters live in?",
];
const WHILE_FLAVOR: Record<Flavor, string[]> = {
  mystery: ["Who is your suspect right now, and what evidence are you leaning on?", "Which clue do you think the author wants you to overlook?"],
  romance: ["What is standing between the leads, and does the obstacle feel real?", "Which small moment between them has mattered most so far?"],
  fantasy: ["Which rule of this world is the story most likely to test?", "How does the magic or power system shape what the characters can choose?"],
  scifi: ["What idea is the book really about underneath the setting?", "Which piece of the imagined future feels closest to our own?"],
  historical: ["Where do you sense the author bending history to serve the story?", "How are everyday details being used to put you in the period?"],
  nonfiction: ["Which argument so far convinced you, and which one needs more evidence?", "What would you ask the author if you could stop them here?"],
  memoir: ["Where does the author seem most honest, and where most guarded?", "How does the author treat the other people in their life on the page?"],
  horror: ["What has the book made you dread, and how is it building that dread?", "Which ordinary thing has become unsettling?"],
  literary: ["What image or motif keeps returning, and what is it carrying?", "Which sentence would you read aloud to the group?"],
  young_adult: ["How does the book treat its young characters: with respect, nostalgia or warning?", "Which adult in the story is helping, and which is in the way?"],
  classic: ["What in these chapters surprised you about the period's attitudes?", "Which passage feels as if it could have been written this year?"],
};

const END_GENERAL = [
  "Did the ending feel earned? What would you have changed?",
  "Which character changed the most, and was the change convincing?",
  "What do you think {author} wanted you to feel on the last page, and did you?",
  "What is the one scene you will still remember in a year?",
  "Who would you recommend {title} to, and who should skip it?",
];
const END_FLAVOR: Record<Flavor, string[]> = {
  mystery: ["Was the solution fair? Could an attentive reader have got there first?"],
  romance: ["Do you believe this couple lasts? What in the book supports your answer?"],
  fantasy: ["Which threads were left open, and do you want them pulled?"],
  scifi: ["Does the book's vision of the future feel like a warning, a hope, or a mirror?"],
  historical: ["What did the book teach you about the period that a textbook would not?"],
  nonfiction: ["What will you do differently, if anything, having read this?"],
  memoir: ["What did the author leave out, and why do you think so?"],
  horror: ["Was the ending a release or another turn of the screw?"],
  literary: ["What is the book finally about? Did the group agree?"],
  young_adult: ["What would your teenage self have taken from this book?"],
  classic: ["Does it deserve its reputation? Make the case for or against."],
};

const BEYOND = [
  "If the club could meet {author}, what is the one question you would ask?",
  "What other book, film or album does this remind you of, and what does the comparison reveal?",
  "What should the club read next to continue this conversation, or to argue with it?",
  "Which real-world issue does the book speak to today, intentionally or not?",
];

function fill(text: string, input: TemplateInput): string {
  const author = input.authors[0] ?? "the author";
  return text.replaceAll("{title}", input.title).replaceAll("{author}", author);
}

function pick<T>(list: T[], seed: number, count: number): T[] {
  if (list.length <= count) return [...list];
  const out: T[] = [];
  let i = seed % list.length;
  while (out.length < count) {
    out.push(list[i]!);
    i = (i + 1) % list.length;
  }
  return out;
}

/** Chapter room whose gate is the first one at or past `chapter`, if any. */
function roomForChapter(rooms: TemplateRoom[], chapter: number): string | null {
  const candidates = rooms
    .filter((r) => r.kind === "chapter" && r.gateType === "chapter" && r.gateValue !== null)
    .sort((a, b) => (a.gateValue ?? 0) - (b.gateValue ?? 0));
  const exact = candidates.find((r) => r.gateValue === chapter);
  if (exact) return exact.id;
  return candidates.find((r) => (r.gateValue ?? 0) >= chapter)?.id ?? null;
}

/** Build a 12-18 question guide. Questions get stable ids q1..qN. */
export function buildTemplateGuide(input: TemplateInput): GuideSection[] {
  const seed = hash(`${input.title}|${input.authors.join(",")}`);
  const flavors = detectFlavors(input);
  let n = 0;
  const q = (text: string, roomId: string | null = null): GuideQuestion => ({ id: `q${++n}`, text: fill(text, input), roomId });

  const before: GuideQuestion[] = [...pick(BEFORE_GENERAL, seed, 2), ...flavors.slice(0, 1).flatMap((f) => BEFORE_FLAVOR[f])].map((t) => q(t));

  const whilePool = [...flavors.flatMap((f) => WHILE_FLAVOR[f]), ...pick(WHILE_GENERAL, seed >> 3, 6)];
  const whileQs: GuideQuestion[] = [];
  const reflection = input.rooms.find((r) => r.kind === "reflection") ?? null;
  if (input.chapters && input.chapters > 0) {
    const blocks = Math.min(4, input.chapters);
    const size = Math.ceil(input.chapters / blocks);
    let start = 1;
    let b = 0;
    while (start <= input.chapters && whileQs.length < 8) {
      const end = Math.min(input.chapters, start + size - 1);
      const label = start === end ? `Chapter ${start}` : `Chapters ${start} to ${end}`;
      const roomId = roomForChapter(input.rooms, end);
      const texts = pick(whilePool, seed + b * 7, 2);
      for (const t of texts) if (whileQs.length < 8) whileQs.push(q(`${label}: ${t}`, roomId));
      start = end + 1;
      b++;
    }
  } else {
    const milestones = input.rooms.filter((r) => r.kind === "milestone" || r.kind === "chapter").sort((a, b) => (a.gateValue ?? 0) - (b.gateValue ?? 0));
    pick(whilePool, seed, 5).forEach((t, i) => whileQs.push(q(t, milestones[i % Math.max(1, milestones.length)]?.id ?? null)));
  }

  const end: GuideQuestion[] = [...pick(END_GENERAL, seed >> 5, 3), ...flavors.slice(0, 1).flatMap((f) => END_FLAVOR[f])].map((t) => q(t, reflection?.id ?? null));
  const beyond: GuideQuestion[] = pick(BEYOND, seed >> 7, 3).map((t) => q(t));

  // Short books with few chapters and no genre hints can land under 12; top up "While reading" with unused general questions.
  const used = new Set(whileQs.map((x) => x.text));
  for (const t of WHILE_GENERAL) {
    if (before.length + whileQs.length + end.length + beyond.length >= 12) break;
    const text = fill(t, input);
    if (!used.has(text) && !whileQs.some((x) => x.text.endsWith(text))) whileQs.push(q(t));
  }

  return [
    { title: "Before you start", questions: before },
    { title: "While reading", questions: whileQs },
    { title: "At the end", questions: end },
    { title: "Beyond the book", questions: beyond },
  ];
}
