import { NextResponse } from "next/server";
import { getOrInitGuestSession, getGuestSessionTtlSeconds } from "@/lib/redis/guestSession";

export async function POST() {
  const { id, session } = await getOrInitGuestSession();
  return NextResponse.json({ sessionId: id, currentStage: session.currentStage });
}

/**
 * Read-only status check — powers the client's inactivity-timeout warning countdown, and (via
 * the app/page.tsx poll that already runs for that) is also how a "syntax-checked" boilerplate
 * message upgrades to a build-verified one once /preview/[ref] reports a successful boot back —
 * see lib/types.ts's boilerplateBuildVerified for why nothing should be gated on this value.
 */
export async function GET() {
  const { id, session } = await getOrInitGuestSession();
  const ttlSeconds = await getGuestSessionTtlSeconds(id);
  return NextResponse.json({
    sessionId: id,
    currentStage: session.currentStage,
    ttlSeconds,
    boilerplateBuildVerified: session.boilerplateBuildVerified ?? false,
  });
}
