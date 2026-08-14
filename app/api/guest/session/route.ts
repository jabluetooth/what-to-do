import { NextResponse } from "next/server";
import { getOrInitGuestSession, getGuestSessionTtlSeconds } from "@/lib/redis/guestSession";

export async function POST() {
  const { id, session } = await getOrInitGuestSession();
  return NextResponse.json({ sessionId: id, currentStage: session.currentStage });
}

/** Read-only status check — powers the client's inactivity-timeout warning countdown. */
export async function GET() {
  const { id, session } = await getOrInitGuestSession();
  const ttlSeconds = await getGuestSessionTtlSeconds(id);
  return NextResponse.json({ sessionId: id, currentStage: session.currentStage, ttlSeconds });
}
