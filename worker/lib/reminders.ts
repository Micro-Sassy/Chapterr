import type { Env } from "../env";

/** Feature wave 2 (W1): pre-meeting reminders, see docs/FEATURES-2.md §1. Idempotent via meeting_reminders_sent. */
export async function runMeetingReminders(_env: Env, _now: Date): Promise<void> {
  // implemented by W1
}
