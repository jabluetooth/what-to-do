import { NextResponse } from "next/server";
import { getOrInitGuestSession } from "@/lib/redis/guestSession";
import { enforceGuestGenerationCap, RateLimitExceededError } from "@/lib/redis/rateLimit";
import { createJob } from "@/lib/pipeline/jobs";
import { enqueueBoilerplateJob } from "@/lib/pipeline/enqueue";

export async function POST() {
  const { id: sessionId, session } = await getOrInitGuestSession();

  if (!session.prdSections || !session.prompt) {
    return NextResponse.json({ error: "Generate a PRD first before generating a boilerplate." }, { status: 409 });
  }

  try {
    await enforceGuestGenerationCap(sessionId, "boilerplate");
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
