import { NextResponse } from "next/server";
import { getOrCreateGuestSessionId, readGuestSession, deleteGuestSession } from "@/lib/redis/guestSession";
import { deleteProjectFiles } from "@/lib/pipeline/projectFiles";

/**
 * Explicit purge (PRD §5.1.6/§6.7): fired on an explicit "discard and start over" and,
 * best-effort, on tab close via sendBeacon. The R2 bucket's own lifecycle rule (see
 * scripts/setup-r2-lifecycle.mjs) is the backstop for when this never runs at all — crashes,
 * force-quits, and network drops mean this can't be relied on as the only deletion path.
 */
export async function POST() {
  const sessionId = await getOrCreateGuestSessionId();
  const session = await readGuestSession(sessionId);

  if (session?.boilerplateR2Prefix) {
    await deleteProjectFiles(session.boilerplateR2Prefix).catch((err) => {
      console.warn("[guest/exit] failed to delete R2 files, Redis session deletion will still proceed:", err);
    });
  }

  await deleteGuestSession(sessionId);

  return NextResponse.json({ ok: true });
}
