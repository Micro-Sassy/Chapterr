import type { MeetingFull, MeetingPack } from "../../shared/types";
import { all, first, run } from "./db";
import { nowIso } from "./util";

/**
 * Meeting pack (docs/FEATURES-2.md §1): a one-page briefing built from the
 * meeting's book. The result is cached as JSON in club_meetings.agenda for
 * ten minutes; `refresh` bypasses the cache. Only club-visible quotes and
 * reviews are included, because the cache is shared by every viewer.
 */

const TTL_MS = 10 * 60_000;

interface CachedPack {
  cachedAt: string;
  viewerId: string;
  pack: MeetingPack;
}

interface GuideSection {
  title?: string;
  questions?: { text?: string }[];
}

const excerpt = (text: string, max = 280) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}...` : text);

export async function buildMeetingPack(db: D1Database, clubId: string, meeting: MeetingFull, viewerId: string, refresh = false): Promise<MeetingPack> {
  const cachedRow = await first<{ agenda: string | null }>(db, "SELECT agenda FROM club_meetings WHERE id = ? AND club_id = ?", meeting.id, clubId);
  if (!refresh && cachedRow?.agenda) {
    try {
      const cached = JSON.parse(cachedRow.agenda) as CachedPack;
      if (cached.pack && Date.parse(cached.cachedAt) > Date.now() - TTL_MS) {
        // RSVP numbers are cheap and change often; always serve the live ones.
        return { ...cached.pack, rsvp: meeting.rsvp };
      }
    } catch {
      // Rebuild below.
    }
  }

  const editionId = meeting.edition?.id ?? null;
  const [guide, quotes, reviews, lastNotes, gaps] = await Promise.all([
    editionId
      ? first<{ sections: string }>(db, "SELECT sections FROM discussion_guides WHERE club_id = ? AND edition_id = ?", clubId, editionId)
      : Promise.resolve(null),
    editionId
      ? all<{ text: string; location: string | null; name: string }>(
          db,
          `SELECT q.text, q.location, u.name FROM quotes q JOIN "user" u ON u.id = q.user_id JOIN club_members cm ON cm.club_id = ? AND cm.user_id = q.user_id
            WHERE q.edition_id = ? AND q.visibility = 'club' ORDER BY q.created_at DESC LIMIT 12`,
          clubId,
          editionId,
        )
      : Promise.resolve([]),
    editionId
      ? all<{ body: string; sentiment: string; name: string }>(
          db,
          `SELECT r.body, r.sentiment, u.name FROM reviews r JOIN "user" u ON u.id = r.user_id JOIN club_members cm ON cm.club_id = ? AND cm.user_id = r.user_id
            WHERE r.edition_id = ? AND r.visibility = 'club' ORDER BY r.updated_at DESC LIMIT 12`,
          clubId,
          editionId,
        )
      : Promise.resolve([]),
    first<{ title: string; starts_at: string; notes: string }>(
      db,
      `SELECT title, starts_at, notes FROM club_meetings WHERE club_id = ? AND id <> ? AND archived_at IS NULL AND notes IS NOT NULL AND notes <> '' AND starts_at < ?
        ORDER BY starts_at DESC LIMIT 1`,
      clubId,
      meeting.id,
      meeting.startsAt,
    ),
    all<{ list: string; item: string; quantity: number; claimed: number }>(
      db,
      `SELECT l.title AS list, i.label AS item, i.quantity, (SELECT COUNT(*) FROM signup_claims c WHERE c.item_id = i.id) AS claimed
         FROM signup_items i JOIN signup_lists l ON l.id = i.list_id WHERE l.club_id = ? AND l.meeting_id = ? ORDER BY l.created_at, i.position`,
      clubId,
      meeting.id,
    ),
  ]);

  const questions: string[] = [];
  const agenda: MeetingPack["agenda"] = [];
  if (guide?.sections) {
    try {
      const sections = JSON.parse(guide.sections) as GuideSection[];
      for (const section of Array.isArray(sections) ? sections : []) {
        const texts = (section.questions ?? []).map((q) => q.text?.trim()).filter((t): t is string => !!t);
        if (texts.length) {
          agenda.push({ title: section.title?.trim() || "Discussion", items: texts });
          questions.push(...texts);
        }
      }
    } catch {
      // Malformed guide: skip it.
    }
  }
  if (agenda.length === 0) {
    agenda.push({
      title: "Suggested agenda",
      items: [
        "Welcome and check-in",
        meeting.edition ? `First impressions of ${meeting.edition.title}` : "What everyone has been reading",
        "Discussion",
        "Pick the next read and date",
        "Thanks and wrap-up",
      ],
    });
  }

  const pack: MeetingPack = {
    meetingId: meeting.id,
    generatedAt: nowIso(),
    book: meeting.edition,
    agenda,
    questions: questions.slice(0, 40),
    quotes: quotes.map((q) => ({ text: excerpt(q.text, 400), author: q.name, location: q.location ?? null })),
    reviews: reviews.filter((r) => r.body.trim()).map((r) => ({ author: r.name, sentiment: r.sentiment, excerpt: excerpt(r.body) })),
    lastNotes: lastNotes ? { meetingTitle: lastNotes.title, startsAt: lastNotes.starts_at, notes: lastNotes.notes } : null,
    rsvp: meeting.rsvp,
    signupGaps: gaps.filter((g) => Number(g.claimed) < Number(g.quantity)).map((g) => ({ list: g.list, item: g.item, needed: Number(g.quantity) - Number(g.claimed) })),
  };
  const cached: CachedPack = { cachedAt: pack.generatedAt, viewerId, pack };
  await run(db, "UPDATE club_meetings SET agenda = ? WHERE id = ? AND club_id = ?", JSON.stringify(cached), meeting.id, clubId);
  return pack;
}
