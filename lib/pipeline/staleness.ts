import type { GuestSession } from "@/lib/types";

/**
 * Staleness fan-out rule (see build plan §2): PRD edit/regenerate marks an
 * existing stack stale. It's a mutation helper, not a pure function — callers
 * still own writing the session back to Redis.
 */
export function markStackStaleIfPresent(session: GuestSession): void {
  if (session.stack) {
    session.stackStale = true;
  }
}
