import { NextResponse } from "next/server";
import { getOrCreateGuestSessionId } from "@/lib/redis/guestSession";
import { getJob, updateJob } from "@/lib/pipeline/jobs";
import { enqueueBoilerplateJob } from "@/lib/pipeline/enqueue";

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
