import { NextResponse } from "next/server";
import { getOrCreateGuestSessionId } from "@/lib/redis/guestSession";
import { getRecentIdeaTitles, pushRecentIdeaTitle } from "@/lib/redis/recentIdeas";
import { generateRandomIdea } from "@/lib/llm/ideas";

// Deliberately uncapped per PRD §6.1.1: "Randomize again... can repeat indefinitely with no cap in v1."
export async function POST() {
  const sessionId = await getOrCreateGuestSessionId();
  const recentTitles = await getRecentIdeaTitles(sessionId);

  const idea = await generateRandomIdea(recentTitles);
  await pushRecentIdeaTitle(sessionId, idea.title);

  return NextResponse.json(idea);
}
