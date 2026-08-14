import { getJob, updateJob, claimJobRun, releaseJobRun } from "@/lib/pipeline/jobs";
import { readGuestSession, writeGuestSession } from "@/lib/redis/guestSession";
import { loadTemplate, type TemplateFile } from "@/lib/pipeline/template";
import { generateBoilerplateFillIn } from "@/lib/llm/boilerplate";
import { writeProjectFiles, buildZip, writeProjectZip } from "@/lib/pipeline/projectFiles";
import { validateBoilerplate } from "@/lib/sandbox/validate";

const MAX_LOG_CHARS = 4000;

function mergeFillIn(
  templateFiles: TemplateFile[],
  fillIn: { mainResourceName: string; schemaFileContent: string; mainRouteFileContent: string; homePageFileContent: string }
): TemplateFile[] {
  const files = templateFiles.map((f) => ({ ...f }));

  const schemaFile = files.find((f) => f.path === "lib/db/schema.ts");
  if (schemaFile) schemaFile.content = fillIn.schemaFileContent;

  const pageFile = files.find((f) => f.path === "app/page.tsx");
  if (pageFile) pageFile.content = fillIn.homePageFileContent;

  files.push({
    path: `app/api/${fillIn.mainResourceName}/route.ts`,
    content: fillIn.mainRouteFileContent,
  });

  return files;
}

/**
 * The actual pipeline: template select -> LLM fill-in -> write files -> install -> build check.
 * A job only counts as "succeeded" once the build check passes (PRD §10 risk: LLM-generated
 * fill-in on top of templates carries hallucination risk — bad imports, mismatched versions —
 * so this is required, not optional).
 */
export async function runBoilerplateJob(jobId: string): Promise<void> {
  // QStash is at-least-once delivery and run-stage responds before this finishes, so a
  // redelivery must not be allowed to run the same job a second time concurrently. Losing the
  // race just means a genuine duplicate delivery — return quietly, the other invocation owns it.
  const claimed = await claimJobRun(jobId);
  if (!claimed) return;

  try {
    const job = await getJob(jobId);
    if (!job) return;

    const session = await readGuestSession(job.sessionId);
    if (!session || !session.prdSections || !session.prompt) {
      await updateJob(jobId, { state: "failed", progress: 100, error: "Session or PRD missing." });
      return;
    }

    try {
      await updateJob(jobId, { state: "running", progress: 5, message: "Selecting template..." });
      const templateFiles = await loadTemplate();

      await updateJob(jobId, { progress: 20, message: "Generating routes & models..." });
      const fillIn = await generateBoilerplateFillIn({
        prompt: session.prompt,
        sections: session.prdSections,
      });

      await updateJob(jobId, { progress: 45, message: "Generating initial UI..." });
      const files = mergeFillIn(templateFiles, fillIn);

      await updateJob(jobId, { progress: 60, message: "Writing project files..." });
      const prefix = `guest/${job.sessionId}/${jobId}`;
      const zip = await buildZip(files);
      await Promise.all([writeProjectFiles(prefix, files), writeProjectZip(prefix, zip)]);

      // Awaited (not fire-and-forget): updateJob is a plain read-modify-write, so an in-flight
      // progress write racing the final state write below could land last and silently revert
      // a completed job back to "running" forever. Awaiting keeps every write to this job
      // strictly ordered.
      const validation = await validateBoilerplate(files, async (phase) => {
        if (phase === "install") {
          await updateJob(jobId, { progress: 75, message: "Installing dependencies..." });
        } else {
          await updateJob(jobId, { progress: 90, message: "Running build check..." });
        }
      });

      if (!validation.passed) {
        await updateJob(jobId, {
          state: "failed",
          progress: 100,
          message: "Build validation failed",
          error: validation.log.slice(-MAX_LOG_CHARS),
        });
        return;
      }

      await updateJob(jobId, { state: "succeeded", progress: 100, message: "Done", resultRef: prefix });

      session.boilerplateR2Prefix = prefix;
      session.boilerplateStale = false;
      // Always true in v1 — see the field's doc comment in lib/types.ts.
      session.boilerplateWebContainerCompatible = true;
      session.currentStage = "boilerplate";
      session.updatedAt = new Date().toISOString();
      await writeGuestSession(job.sessionId, session);
    } catch (err) {
      await updateJob(jobId, {
        state: "failed",
        progress: 100,
        message: "Generation failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    await releaseJobRun(jobId);
  }
}
