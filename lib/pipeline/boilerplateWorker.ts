import { getJob, updateJob, claimJobRun, releaseJobRun } from "@/lib/pipeline/jobs";
import { readGuestSession, writeGuestSession } from "@/lib/redis/guestSession";
import { loadTemplate, resolveTemplateId, isWebContainerCompatible, FASTAPI_TEMPLATE_ID, type TemplateFile } from "@/lib/pipeline/template";
import { generateBoilerplateFillIn } from "@/lib/llm/boilerplate";
import { generateFastapiFillIn } from "@/lib/llm/boilerplateFastapi";
import { writeProjectFiles, buildZip, writeProjectZip } from "@/lib/pipeline/projectFiles";
import { validateBoilerplate, validateFastapiBoilerplate, type ValidationResult } from "@/lib/sandbox/validate";
import { refundGenerationCap } from "@/lib/redis/rateLimit";
import type { PrdSection } from "@/lib/types";

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

function mergeFastapiFillIn(
  templateFiles: TemplateFile[],
  fillIn: { modelsFileContent: string; mainFileContent: string }
): TemplateFile[] {
  const files = templateFiles.map((f) => ({ ...f }));

  const modelsFile = files.find((f) => f.path === "models.py");
  if (modelsFile) modelsFile.content = fillIn.modelsFileContent;

  const mainFile = files.find((f) => f.path === "main.py");
  if (mainFile) mainFile.content = fillIn.mainFileContent;

  return files;
}

/**
 * Fill-in generation branches on which template the recommended stack resolved to (see
 * template.ts's resolveTemplateId) — this is the actual fix for boilerplate always being
 * Next.js regardless of the recommended stack. Next.js gets 3 fill-in files (schema, route,
 * homepage); FastAPI gets 2 (model, main.py — see boilerplateFastapi.ts for why it doesn't
 * need a separate homepage file).
 */
async function generateFillInFiles(
  templateId: string,
  templateFiles: TemplateFile[],
  prompt: string,
  sections: PrdSection[],
  jobId: string
): Promise<TemplateFile[]> {
  if (templateId === FASTAPI_TEMPLATE_ID) {
    await updateJob(jobId, { progress: 20, message: "Generating models & routes..." });
    const fillIn = await generateFastapiFillIn({ prompt, sections });
    return mergeFastapiFillIn(templateFiles, fillIn);
  }

  await updateJob(jobId, { progress: 20, message: "Generating routes & models..." });
  const fillIn = await generateBoilerplateFillIn({ prompt, sections });
  await updateJob(jobId, { progress: 45, message: "Generating initial UI..." });
  return mergeFillIn(templateFiles, fillIn);
}

/**
 * Validation branches the same way: Next.js gets a real pnpm install + build (validateBoilerplate);
 * FastAPI gets a lighter syntax-only check (validateFastapiBoilerplate) — see that function's
 * doc comment for why a real pip install/run isn't attempted.
 */
async function runValidation(templateId: string, files: TemplateFile[], jobId: string): Promise<ValidationResult> {
  if (templateId === FASTAPI_TEMPLATE_ID) {
    return validateFastapiBoilerplate(files, async (phase) => {
      if (phase === "build") await updateJob(jobId, { progress: 90, message: "Checking generated Python..." });
    });
  }

  return validateBoilerplate(files, async (phase) => {
    if (phase === "install") {
      await updateJob(jobId, { progress: 75, message: "Installing dependencies..." });
    } else {
      await updateJob(jobId, { progress: 90, message: "Running build check..." });
    }
  });
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
      // Not the user's fault (session expired/race, not a bad generation) — and only refund the
      // one cap unit the original /api/boilerplate/generate call actually consumed, not on a
      // retry that never incremented it again.
      if (job.attempt === 1) await refundGenerationCap(job.sessionId, "boilerplate");
      return;
    }

    try {
      const templateId = resolveTemplateId(session.stack);

      await updateJob(jobId, { state: "running", progress: 5, message: "Selecting template..." });
      const templateFiles = await loadTemplate(templateId);

      // Awaited throughout (not fire-and-forget): updateJob is a plain read-modify-write, so an
      // in-flight progress write racing the final state write below could land last and
      // silently revert a completed job back to "running" forever.
      const files = await generateFillInFiles(templateId, templateFiles, session.prompt, session.prdSections, jobId);

      await updateJob(jobId, { progress: 60, message: "Writing project files..." });
      const prefix = `guest/${job.sessionId}/${jobId}`;
      const zip = await buildZip(files);
      await Promise.all([writeProjectFiles(prefix, files), writeProjectZip(prefix, zip)]);

      const validation = await runValidation(templateId, files, jobId);

      if (!validation.passed) {
        await updateJob(jobId, {
          state: "failed",
          progress: 100,
          message: "Build validation failed",
          error: validation.log.slice(-MAX_LOG_CHARS),
        });
        // Only refund for a platform-side failure (sandbox ran out of disk), not an ordinary
        // failed build check — that already spent real LLM/compute cost, which the cap exists
        // to protect against. Same attempt===1 reasoning as the session-missing case above.
        if (validation.diskFull && job.attempt === 1) {
          await refundGenerationCap(job.sessionId, "boilerplate");
        }
        return;
      }

      const webContainerCompatible = isWebContainerCompatible(templateId);
      // unvalidated (FastAPI-only) means no Python interpreter was found at all, so nothing was
      // actually checked — the inverse of what "syntax-only check" would suggest. Both this
      // message and the flag itself are threaded through to the client (jobs.ts, the status
      // route, app/page.tsx) since the UI previously guessed this from webContainerCompatible
      // alone and always claimed "syntax checked" even when validation.unvalidated was true.
      await updateJob(jobId, {
        state: "succeeded",
        progress: 100,
        message: validation.unvalidated ? "Done (no Python interpreter found — not syntax-checked)" : "Done",
        resultRef: prefix,
        webContainerCompatible,
        unvalidated: validation.unvalidated ?? false,
      });

      session.boilerplateR2Prefix = prefix;
      session.boilerplateStale = false;
      session.boilerplateWebContainerCompatible = webContainerCompatible;
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
