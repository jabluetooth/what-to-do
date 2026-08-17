import { getJob, updateJob, claimJobRun, releaseJobRun } from "@/lib/pipeline/jobs";
import { readGuestSession, writeGuestSessionData } from "@/lib/redis/guestSession";
import { loadTemplate, type TemplateFile } from "@/lib/pipeline/template";
import { resolveTemplate } from "@/lib/pipeline/templateRegistry";
import { getTemplateImplementation, type TemplateImplementation } from "@/lib/pipeline/templateImplementations";
import { writeProjectFiles, buildZip, writeProjectZip } from "@/lib/pipeline/projectFiles";
import type { ValidationResult } from "@/lib/sandbox/validate";
import { refundGenerationCap } from "@/lib/redis/rateLimit";

const MAX_LOG_CHARS = 4000;

/** Validation progress is the same two checkpoints for every template — only the message text (impl.phaseMessages) varies. */
async function runValidation(impl: TemplateImplementation, files: TemplateFile[], jobId: string): Promise<ValidationResult> {
  return impl.validate(files, async (phase) => {
    const message = impl.phaseMessages[phase];
    if (!message) return;
    await updateJob(jobId, { progress: phase === "install" ? 75 : 90, message });
  });
}

/**
 * The actual pipeline: template select -> LLM fill-in -> write files -> validate. A job only
 * counts as "succeeded" once that check passes (PRD §10 risk: LLM-generated fill-in on top of
 * templates carries hallucination risk — bad imports, mismatched versions — so this is
 * required, not optional). The check itself is syntax-only now, not a real install+build (see
 * lib/sandbox/validateSyntax.ts) — it catches malformed code but not import/type errors; the
 * deeper check happens client-side, lazily, if/when the user opens the live preview.
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
      const descriptor = resolveTemplate(session.stack?.backend.choice);
      const impl = getTemplateImplementation(descriptor.id);

      await updateJob(jobId, { state: "running", progress: 5, message: "Selecting template..." });
      const templateFiles = await loadTemplate(descriptor.id);

      // Awaited throughout (not fire-and-forget): updateJob is a plain read-modify-write, so an
      // in-flight progress write racing the final state write below could land last and
      // silently revert a completed job back to "running" forever.
      const files = await impl.generateFillIn(
        templateFiles,
        { prompt: session.prompt, sections: session.prdSections },
        async (progress, message) => {
          await updateJob(jobId, { progress, message });
        }
      );

      await updateJob(jobId, { progress: 60, message: "Writing project files..." });
      const prefix = `guest/${job.sessionId}/${jobId}`;
      const zip = await buildZip(files);
      await Promise.all([writeProjectFiles(prefix, files), writeProjectZip(prefix, zip)]);

      const validation = await runValidation(impl, files, jobId);

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
        webContainerCompatible: descriptor.webContainerCompatible,
        unvalidated: validation.unvalidated ?? false,
      });

      session.boilerplateR2Prefix = prefix;
      session.boilerplateStale = false;
      session.boilerplateWebContainerCompatible = descriptor.webContainerCompatible;
      session.currentStage = "boilerplate";
      session.updatedAt = new Date().toISOString();
      await writeGuestSessionData(job.sessionId, session);
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
