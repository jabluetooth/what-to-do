import { NextResponse } from "next/server";
import { getOrInitGuestSession } from "@/lib/redis/guestSession";
import { enforceGenerationCap, RateLimitExceededError } from "@/lib/redis/rateLimit";
import { createJob } from "@/lib/pipeline/jobs";
import { enqueueBoilerplateJob } from "@/lib/pipeline/enqueue";
import { isModelExhausted } from "@/lib/llm/modelAvailability";
import { MODEL_QUALITY } from "@/lib/groq";

export async function POST() {
  const { id: sessionId, session } = await getOrInitGuestSession();

  if (!session.prdSections || !session.prompt) {
    return NextResponse.json({ error: "Generate a PRD first before generating a boilerplate." }, { status: 409 });
  }

  // Fail fast rather than spend a full install+build cycle: live testing showed the fallback
  // model is unreliable enough at code generation (missing imports, wrong API usage) that an
  // attempt without the quality model is more likely to waste a cycle than succeed.
  if (await isModelExhausted(MODEL_QUALITY)) {
    return NextResponse.json(
      { error: "Boilerplate generation is at capacity right now. Please try again in a few minutes." },
      { status: 503 }
    );
  }

  try {
    await enforceGenerationCap(sessionId, "boilerplate");
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  const job = await createJob(sessionId, "boilerplate");
  await enqueueBoilerplateJob(job.id);

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
