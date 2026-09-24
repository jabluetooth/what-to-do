import { NextResponse } from "next/server";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { getRecentIdeaTitles, pushRecentIdeaTitle } from "@/lib/redis/recentIdeas";
import { enforceGenerationCap, refundGenerationCap, RateLimitExceededError } from "@/lib/redis/rateLimit";
import { generateRandomIdea } from "@/lib/llm/ideas";
import { moderateInput, passedModeration } from "@/lib/llm/moderation";
import type { PlatformHint } from "@/lib/types";

function parsePlatformHint(request: Request): PlatformHint | undefined {
  const raw = new URL(request.url).searchParams.get("platform");
  return raw === "web" || raw === "mobile" ? raw : undefined;
}

/**
 * Mobile equivalent of app/api/ideas/random/route.ts's POST — same generate -> moderate ->
 * push-title flow, but keyed off the bearer-authenticated user instead of a guest cookie session
 * (mobile has no anonymous mode) and always at the "signedIn" tier/cap.
 */
export async function GET(request: Request) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;
  const sessionId = `mobile:${auth.userId}`;

  const tier = "signedIn";
  try {
    await enforceGenerationCap(sessionId, "ideas", tier);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  const recentTitles = await getRecentIdeaTitles(sessionId);
  const platformHint = parsePlatformHint(request);

  let idea;
  try {
    idea = await generateRandomIdea(recentTitles, platformHint);
  } catch {
    // A platform-side failure (the model misbehaving), not the user's fault — don't let it burn
    // one of their few daily rolls.
    await refundGenerationCap(sessionId, "ideas", tier);
    return NextResponse.json(
      { error: "Couldn't generate an idea right now. Please try again in a moment." },
      { status: 502 }
    );
  }

  // Generated ideas pass through the same moderation gate as user prompts (PRD §7) — this is
  // LLM output, not user input, but it still reaches the client and can seed the pipeline.
  const moderation = await moderateInput(`${idea.title}: ${idea.description}`);
  if (!passedModeration(moderation)) {
    await refundGenerationCap(sessionId, "ideas", tier);
    return NextResponse.json(
      { error: "Couldn't generate an idea right now. Please try again." },
      { status: 502 }
    );
  }

  await pushRecentIdeaTitle(sessionId, idea.title);

  return NextResponse.json(idea);
}
