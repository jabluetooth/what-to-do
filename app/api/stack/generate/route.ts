import { NextResponse } from "next/server";
import { getOrInitGuestSession, writeGuestSession } from "@/lib/redis/guestSession";
import { enforceGenerationCap, RateLimitExceededError } from "@/lib/redis/rateLimit";
import { pickStack } from "@/lib/pipeline/stackMatrix";
import { generateStackRationale } from "@/lib/llm/stack";
import { markBoilerplateStaleIfPresent } from "@/lib/pipeline/staleness";
import type { StackRecommendation } from "@/lib/types";

export async function POST() {
  const { id: sessionId, session } = await getOrInitGuestSession();

  if (!session.prdSections || !session.prompt) {
    return NextResponse.json({ error: "Generate a PRD first before recommending a stack." }, { status: 409 });
  }

  try {
    await enforceGenerationCap(sessionId, "stack");
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  const picks = pickStack(session.hints);

  let rationale;
  try {
    rationale = await generateStackRationale({
      prompt: session.prompt,
      sections: session.prdSections,
      picks,
    });
  } catch {
    return NextResponse.json(
      { error: "Couldn't generate stack rationale right now. Please try again in a moment." },
      { status: 502 }
    );
  }

  const stack: StackRecommendation = {
    frontend: { choice: picks.frontend, rationale: rationale.frontend },
    backend: { choice: picks.backend, rationale: rationale.backend },
    database: { choice: picks.database, rationale: rationale.database },
    hosting: { choice: picks.hosting, rationale: rationale.hosting },
    auth: { choice: picks.auth, rationale: rationale.auth },
  };

  session.stack = stack;
  session.stackStale = false;
  markBoilerplateStaleIfPresent(session);
  session.currentStage = "stack";
  session.updatedAt = new Date().toISOString();
  await writeGuestSession(sessionId, session);

  return NextResponse.json({ stack, boilerplateStale: session.boilerplateStale ?? false });
}
