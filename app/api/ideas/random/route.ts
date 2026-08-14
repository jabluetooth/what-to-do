import { NextResponse } from "next/server";
import { getOrCreateGuestSessionId } from "@/lib/redis/guestSession";
import { getRecentIdeaTitles, pushRecentIdeaTitle } from "@/lib/redis/recentIdeas";
import { enforceGenerationCap, RateLimitExceededError } from "@/lib/redis/rateLimit";
import { generateRandomIdea } from "@/lib/llm/ideas";
import { moderateInput } from "@/lib/llm/moderation";

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

  let idea;
  try {
    idea = await generateRandomIdea(recentTitles);
  } catch {
    return NextResponse.json(
      { error: "Couldn't generate an idea right now. Please try again in a moment." },
      { status: 502 }
    );
  }

  // Generated ideas pass through the same moderation gate as user prompts (PRD §7) — this is
  // LLM output, not user input, but it still reaches the client and can seed the pipeline.
  const moderation = await moderateInput(`${idea.title}: ${idea.description}`);
  if (moderation.verdict === "block") {
    return NextResponse.json(
      { error: "Couldn't generate an idea right now. Please try again." },
      { status: 502 }
    );
  }

  await pushRecentIdeaTitle(sessionId, idea.title);

  return NextResponse.json(idea);
}
