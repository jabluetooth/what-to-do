import { NextResponse } from "next/server";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { enforceGenerationCap, RateLimitExceededError } from "@/lib/redis/rateLimit";
import { createJob } from "@/lib/pipeline/jobs";
import { enqueueBoilerplateJob } from "@/lib/pipeline/enqueue";
import { isModelExhausted } from "@/lib/llm/modelAvailability";
import { MODEL_QUALITY } from "@/lib/groq";
import { getLatestVersions, getOwnedProject, mobileSessionId } from "@/lib/mobile/projects";

/**
 * Generates code for a saved project (web: app/api/boilerplate/generate): queues the same worker,
 * which reads this project's PRD and stack and writes a new boilerplate version. Returns a job id
 * the app polls at /api/mobile/jobs/[id]. Same fail-fast and signed-in cap as the web.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;
  const { id } = await params;

  const project = await getOwnedProject(auth.userId, id);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const { prd } = await getLatestVersions(id);
  if (!prd?.sections.length) {
    return NextResponse.json({ error: "Write the spec first before generating code." }, { status: 409 });
  }

  if (await isModelExhausted(MODEL_QUALITY)) {
    return NextResponse.json(
      { error: "Code generation is at capacity right now. Please try again in a few minutes." },
      { status: 503 }
    );
  }

  const sessionId = mobileSessionId(auth.userId);
  try {
    await enforceGenerationCap(sessionId, "boilerplate", "signedIn");
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  const job = await createJob(sessionId, "boilerplate", { projectId: id, userId: auth.userId });
  await enqueueBoilerplateJob(job.id);

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
