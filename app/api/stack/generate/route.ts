import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrInitGuestSession, writeGuestSession } from "@/lib/redis/guestSession";
import { enforceGenerationCap, RateLimitExceededError } from "@/lib/redis/rateLimit";
import { pickStack } from "@/lib/pipeline/stackMatrix";
import { generateStackRationale } from "@/lib/llm/stack";
import { markBoilerplateStaleIfPresent } from "@/lib/pipeline/staleness";
import type { StackRecommendation } from "@/lib/types";

const BodySchema = z
  .object({
    hints: z
      .object({
        platform: z.enum(["web", "mobile"]).optional(),
        scopeSize: z.enum(["weekend", "mvp", "production"]).optional(),
        stackFamiliarity: z.string().max(300).optional(),
      })
      .optional(),
  })
  .optional();

export async function POST(request: Request) {
  const rawBody = await request.text();
  const parsed = BodySchema.safeParse(rawBody ? JSON.parse(rawBody) : undefined);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

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

  // The intake form's hint fields (platform/scope/"stacks you already know") otherwise only
  // ever apply to the very first prompt submission, with no way to adjust them before a later
  // (re)generation of just the stack. A full replace (not a partial merge) so clearing a field
  // in the UI actually clears it here too, rather than a stale previous value lingering because
  // an empty string was dropped by JSON serialization.
  if (parsed.data?.hints) {
    session.hints = parsed.data.hints;
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
