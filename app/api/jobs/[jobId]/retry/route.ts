import { NextResponse } from "next/server";
import { getOrCreateGuestSessionId } from "@/lib/redis/guestSession";
import { getJob, updateJob, claimJobRetry } from "@/lib/pipeline/jobs";
import { enqueueBoilerplateJob } from "@/lib/pipeline/enqueue";
import { isModelExhausted } from "@/lib/llm/modelAvailability";
import { MODEL_QUALITY } from "@/lib/groq";
import { enforceGenerationCap, getGenerationTier, RateLimitExceededError } from "@/lib/redis/rateLimit";

/**
 * Domain-level retry, distinct from QStash's own transport-level delivery retries: this is for
 * when the request reached the worker but the generation/validation logically failed (bad LLM
 * output, failed build check). Re-publishes using the job's existing stored input (just the
 * jobId — the worker re-reads the session), no re-collecting anything from the user.
 */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const sessionId = await getOrCreateGuestSessionId();

  const job = await getJob(jobId);
  if (!job || job.sessionId !== sessionId) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  if (job.state !== "failed") {
    return NextResponse.json({ error: "Only failed jobs can be retried." }, { status: 409 });
  }

  // Dedups a double-click or a retried client request racing itself: without this, two
  // requests can both pass the state check above before either write below lands, producing
  // two QStash publishes for the same job.
  if (!(await claimJobRetry(jobId))) {
    return NextResponse.json({ error: "A retry is already in progress for this job." }, { status: 409 });
  }

  if (job.stage === "boilerplate" && (await isModelExhausted(MODEL_QUALITY))) {
    return NextResponse.json(
      { error: "Boilerplate generation is at capacity right now. Please try again in a few minutes." },
      { status: 503 }
    );
  }

  // A retry re-runs the full LLM generation, so it spends the same cap as a fresh generate —
  // without this, a failed job could be retried indefinitely at full cost.
  try {
    await enforceGenerationCap(sessionId, job.stage, await getGenerationTier());
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  await updateJob(jobId, {
    state: "pending",
    progress: 0,
    message: "Queued",
    error: undefined,
    attempt: job.attempt + 1,
  });

  await enqueueBoilerplateJob(jobId);

  return NextResponse.json({ jobId }, { status: 202 });
}
