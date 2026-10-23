import type { Env } from "../env";

/** Feature wave 2 (W2): scheduled messages, see docs/FEATURES-2.md §3. */
export async function runScheduledMessages(_env: Env, _now: Date): Promise<void> {
  // implemented by W2
}

/** Feature wave 2 (W2): progress-gated catch-up digests, see docs/FEATURES-2.md §4. */
export async function runCatchUpDigests(_env: Env, _now: Date): Promise<void> {
  // implemented by W2
}
