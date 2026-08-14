import { NextResponse } from "next/server";
import { getOrInitGuestSession } from "@/lib/redis/guestSession";

export async function POST() {
  const { id, session } = await getOrInitGuestSession();
  return NextResponse.json({ sessionId: id, currentStage: session.currentStage });
}
