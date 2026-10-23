import { createEmailProvider } from "../email";
import { meetingReminderEmail } from "../email/templates";
import type { Env } from "../env";
import { closeExpiredPolls } from "../routes/polls";
import { all, run } from "./db";
import { notifyUsers } from "./notify";
import { safeZone } from "./recurrence";
import { formatMeetingTime } from "./util";

/**
 * Pre-meeting reminders (docs/FEATURES-2.md §1). Runs every cron tick (15 min).
 * For every upcoming meeting and every offset in clubs.reminder_offsets, the
 * reminder fires once the moment `start - offset` has passed, and never again:
 * the (meeting, offset) row in meeting_reminders_sent is claimed before anything
 * is sent, so late, repeated or concurrent ticks stay idempotent. A reminder
 * whose moment passed more than an hour ago is skipped rather than sent stale.
 */

const MINUTE = 60_000;
/** How long after `start - offset` a reminder may still go out (covers skipped ticks). */
const GRACE_MS = 60 * MINUTE;
const LOOKAHEAD_MS = 31 * 24 * 60 * MINUTE;

/** See the note on SYSTEM_ACTOR in worker/routes/polls.ts. */
const SYSTEM_ACTOR = null as unknown as string;

interface MeetingRow {
  id: string;
  club_id: string;
  title: string;
  starts_at: string;
  location: string | null;
  location_url: string | null;
  timezone: string | null;
  book_title: string | null;
  club_tz: string;
  club_name: string;
  reminder_offsets: string;
}

function parseOffsets(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 60 * 24 * 30))).slice(0, 10);
  } catch {
    return [];
  }
}

export async function runMeetingReminders(env: Env, now: Date): Promise<void> {
  await closeExpiredPolls(env, now).catch((err) => console.error("closeExpiredPolls failed", err instanceof Error ? err.message : err));
  const nowMs = now.getTime();
  const meetings = await all<MeetingRow>(
    env.DB,
    `SELECT m.id, m.club_id, m.title, m.starts_at, m.location, m.location_url, m.timezone, e.title AS book_title, c.timezone AS club_tz, c.name AS club_name, c.reminder_offsets
       FROM club_meetings m JOIN clubs c ON c.id = m.club_id LEFT JOIN book_editions e ON e.id = m.edition_id
      WHERE m.archived_at IS NULL AND c.archived_at IS NULL AND m.starts_at > ? AND m.starts_at <= ?`,
    now.toISOString(),
    new Date(nowMs + LOOKAHEAD_MS).toISOString(),
  );
  for (const m of meetings) {
    const startMs = Date.parse(m.starts_at);
    for (const offset of parseOffsets(m.reminder_offsets)) {
      const fireAt = startMs - offset * MINUTE;
      if (nowMs < fireAt || nowMs >= fireAt + GRACE_MS) continue;
      const claim = await run(env.DB, "INSERT OR IGNORE INTO meeting_reminders_sent (meeting_id, offset_minutes, sent_at) VALUES (?, ?, ?)", m.id, offset, now.toISOString());
      if (claim.meta.changes === 0) continue;
      try {
        await sendReminder(env, m, offset);
      } catch (err) {
        console.error("meeting reminder failed", m.id, offset, err instanceof Error ? err.message : err);
      }
    }
  }
}

async function sendReminder(env: Env, m: MeetingRow, offset: number): Promise<void> {
  const recipients = await all<{ user_id: string }>(
    env.DB,
    `SELECT cm.user_id FROM club_members cm LEFT JOIN meeting_rsvps r ON r.meeting_id = ? AND r.user_id = cm.user_id
      WHERE cm.club_id = ? AND (r.status IS NULL OR r.status <> 'no')`,
    m.id,
    m.club_id,
  );
  if (recipients.length === 0) return;
  const ids = recipients.map((r) => r.user_id);
  const zone = safeZone(m.timezone, safeZone(m.club_tz, "America/Chicago"));
  const when = formatMeetingTime(m.starts_at, zone);
  const lead = offset >= 1440 ? `${Math.round(offset / 1440)} day${offset >= 2880 ? "s" : ""}` : offset >= 60 ? `${Math.round(offset / 60)} hour${offset >= 120 ? "s" : ""}` : `${offset} minutes`;
  const link = `/c/${m.club_id}/meetings/${m.id}`;
  const body = [`In ${lead}: ${when}`, m.location ? `at ${m.location}` : null].filter(Boolean).join(", ");
  await notifyUsers(env, ids, { kind: "meeting_reminder", clubId: m.club_id, title: `Reminder: ${m.title}`, body, link, actorId: SYSTEM_ACTOR });

  const emails = await all<{ email: string; name: string }>(
    env.DB,
    `SELECT u.email, u.name FROM "user" u LEFT JOIN notification_preferences np ON np.user_id = u.id
      WHERE u.id IN (${ids.map(() => "?").join(", ")}) AND u."emailVerified" = 1 AND COALESCE(np.email_meeting_reminders, 1) = 1`,
    ...ids,
  );
  if (emails.length === 0) return;
  let provider;
  try {
    provider = createEmailProvider(env);
  } catch (err) {
    console.error("reminder email skipped:", err instanceof Error ? err.message : err);
    return;
  }
  const url = `${env.PUBLIC_APP_URL.replace(/\/+$/, "")}${link}`;
  for (const t of emails) {
    try {
      await provider.send(meetingReminderEmail(t.email, t.name, m.club_name, { title: m.title, when, location: m.location, locationUrl: m.location_url, book: m.book_title }, url));
    } catch (err) {
      console.error("reminder email failed", err instanceof Error ? err.message : err);
    }
  }
}
