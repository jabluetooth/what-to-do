import { NextResponse } from "next/server";
import { getOrCreateGuestSessionId } from "@/lib/redis/guestSession";
import { getJob } from "@/lib/pipeline/jobs";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const sessionId = await getOrCreateGuestSessionId();

  const job = await getJob(jobId);
  // Ownership check against the session cookie, not a client-supplied id — no cross-session leakage.
  if (!job || job.sessionId !== sessionId) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json({
    state: job.state,
    progress: job.progress,
    message: job.message,
    error: job.error,
    webContainerCompatible: job.webContainerCompatible,
  });
}
