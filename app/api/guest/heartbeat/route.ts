import { NextResponse } from "next/server";
import {
  getOrCreateGuestSessionId,
  refreshGuestSession,
  getGuestSessionTtlSeconds,
} from "@/lib/redis/guestSession";

/** Explicit "I'm still here" — used by the timeout-warning banner's "Keep working" action. */
export async function POST() {
  const sessionId = await getOrCreateGuestSessionId();
  const session = await refreshGuestSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "No active session to refresh." }, { status: 404 });
  }

  const ttlSeconds = await getGuestSessionTtlSeconds(sessionId);
  return NextResponse.json({ ttlSeconds });
}
