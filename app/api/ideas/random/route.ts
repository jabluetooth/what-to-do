import { NextResponse } from "next/server";
import { getOrCreateGuestSessionId } from "@/lib/redis/guestSession";
import { getRecentIdeaTitles, pushRecentIdeaTitle } from "@/lib/redis/recentIdeas";
import { enforceGenerationCap, RateLimitExceededError } from "@/lib/redis/rateLimit";
import { generateRandomIdea } from "@/lib/llm/ideas";

// Capped per-day like every other generation stage — supersedes the original PRD §6.1.1
// "no cap in v1" call, revised once real usage costs were being observed live.
export async function POST() {
  const sessionId = await getOrCreateGuestSessionId();

  try {
    await enforceGenerationCap(sessionId, "ideas");
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  const recentTitles = await getRecentIdeaTitles(sessionId);

  const idea = await generateRandomIdea(recentTitles);
  await pushRecentIdeaTitle(sessionId, idea.title);

  return NextResponse.json(idea);
}
