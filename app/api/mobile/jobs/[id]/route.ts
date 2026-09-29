import { NextResponse } from "next/server";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { getJob } from "@/lib/pipeline/jobs";
import { mobileSessionId } from "@/lib/mobile/projects";

/** Progress of a mobile build job; only its owner can read it (web: app/api/jobs/[jobId]/status). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;
  const { id } = await params;

  const job = await getJob(id);
  if (!job || job.sessionId !== mobileSessionId(auth.userId)) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json({
    state: job.state,
    progress: job.progress,
    message: job.message,
    error: job.error ?? null,
    projectId: job.projectId ?? null,
    unvalidated: job.unvalidated ?? false,
  });
}
