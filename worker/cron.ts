import type { Env } from "./env";
import { runHousekeeping } from "./index";
import { runMeetingReminders } from "./lib/reminders";
import { runCatchUpDigests, runScheduledMessages } from "./lib/digest";

/**
 * Cron dispatcher (wrangler.jsonc triggers.crons = every 15 minutes).
 * Each job is owned by a feature stream (docs/FEATURES-2.md) and must be
 * idempotent: a tick can be late, repeated or skipped.
 */
export async function runCron(env: Env, now = new Date()): Promise<void> {
  const jobs: [string, Promise<unknown>][] = [
    ["meeting reminders", runMeetingReminders(env, now)],
    ["scheduled messages", runScheduledMessages(env, now)],
  ];
  // Daily jobs ride the first tick after 04:00 and 13:00 UTC.
  if (now.getUTCHours() === 4 && now.getUTCMinutes() < 15) jobs.push(["housekeeping", runHousekeeping(env, now)]);
  if (now.getUTCHours() === 13 && now.getUTCMinutes() < 15) jobs.push(["catch-up digests", runCatchUpDigests(env, now)]);
  const results = await Promise.allSettled(jobs.map(([, p]) => p));
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`cron job failed: ${jobs[i]![0]}`, r.reason instanceof Error ? r.reason.message : r.reason);
  });
}
