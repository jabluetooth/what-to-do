import { eq } from "drizzle-orm";
import { getJob, updateJob, claimJobRun, releaseJobRun, type JobRecord } from "@/lib/pipeline/jobs";
import { getDb } from "@/lib/db/client";
import { boilerplateVersions, projects } from "@/lib/db/schema";
import { getLatestVersions, getOwnedProject } from "@/lib/mobile/projects";
import { readGuestSession, writeGuestSessionData } from "@/lib/redis/guestSession";
import { loadTemplate, type TemplateFile } from "@/lib/pipeline/template";
import { resolveTemplate } from "@/lib/pipeline/templateRegistry";
import { getTemplateImplementation, type TemplateImplementation } from "@/lib/pipeline/templateImplementations";
import { writeProjectFiles, buildZip, writeProjectZip, deleteProjectFiles } from "@/lib/pipeline/projectFiles";
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

    // Mobile builds generate from a saved project, not a guest session.
    if (job.projectId && job.userId) {
      await runProjectBoilerplateJob(job);
      return;
    }

    const session = await readGuestSession(job.sessionId);
    if (!session || !session.prdSections || !session.prompt) {
      await updateJob(jobId, { state: "failed", progress: 100, error: "Session or PRD missing." });
      // Not the user's fault (session expired/race, not a bad generation). Every attempt —
      // the original generate and each retry — consumed one cap unit, so any attempt refunds.
      await refundGenerationCap(job.sessionId, "boilerplate");
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
        // to protect against.
        if (validation.diskFull) {
          await refundGenerationCap(job.sessionId, "boilerplate");
        }
        return;
      }

      // Re-read rather than write back the copy from the start of the run: this job takes
      // minutes, and writing that stale snapshot back silently reverted any PRD edit or stack
      // override made in the meantime (confirmed live), and resurrected a session the user had
      // already discarded. Only the boilerplate fields are patched onto the current session.
      const latest = await readGuestSession(job.sessionId);
      if (!latest) {
        // Started over, converted to an account, or expired while this ran — the session is
        // gone on purpose, so don't bring it back, and don't leave its files behind either.
        await deleteProjectFiles(prefix).catch((err) => {
          console.warn("[boilerplateWorker] failed to delete files for an ended session:", err);
        });
        await updateJob(jobId, {
          state: "failed",
          progress: 100,
          message: "Session ended",
          error: "This session ended before the boilerplate finished.",
        });
        return;
      }

      // Generated from the snapshot above — if the PRD or stack moved on meanwhile, the result
      // is already out of date and should say so rather than claim to be current.
      const inputsChanged =
        JSON.stringify(latest.prdSections) !== JSON.stringify(session.prdSections) ||
        JSON.stringify(latest.stack) !== JSON.stringify(session.stack);

      const previousPrefix = latest.boilerplateR2Prefix;
      latest.boilerplateR2Prefix = prefix;
      latest.boilerplateStale = inputsChanged;
      latest.boilerplateWebContainerCompatible = descriptor.webContainerCompatible;
      latest.boilerplateBuildVerified = false;
      latest.currentStage = "boilerplate";
      latest.updatedAt = new Date().toISOString();
      await writeGuestSessionData(job.sessionId, latest);

      // The superseded boilerplate is unreachable now; the R2 lifecycle rule is only a backstop.
      if (previousPrefix && previousPrefix !== prefix) {
        await deleteProjectFiles(previousPrefix).catch((err) => {
          console.warn("[boilerplateWorker] failed to delete superseded boilerplate files:", err);
        });
      }

      // Marked succeeded only after the session points at the new files, so a client that sees
      // "succeeded" can immediately download/preview them.
      //
      // unvalidated (FastAPI-only) means no Python interpreter was found at all, so nothing was
      // actually checked. Both this message and the flag are threaded through to the client
      // (jobs.ts, the status route, app/page.tsx).
      await updateJob(jobId, {
        state: "succeeded",
        progress: 100,
        message: validation.unvalidated ? "Done (no Python interpreter found — not syntax-checked)" : "Done",
        resultRef: prefix,
        webContainerCompatible: descriptor.webContainerCompatible,
        unvalidated: validation.unvalidated ?? false,
        stale: inputsChanged,
      });
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

/**
 * The mobile build: same template -> LLM fill-in -> write -> validate pipeline as above, but the
 * PRD and stack come from a saved project (Postgres) and a success becomes a new
 * boilerplate_version row under "project/{projectId}/{versionId}" — the same place a converted
 * web project's files live, so the web's History (download, preview) works on it too.
 * Runs under the caller's run lock (runBoilerplateJob), and refunds follow the same policy:
 * only platform-side failures give the cap unit back.
 */
async function runProjectBoilerplateJob(job: JobRecord): Promise<void> {
  const { id: jobId, projectId, userId, sessionId } = job;
  if (!projectId || !userId) return;

  const project = await getOwnedProject(userId, projectId);
  const versions = project ? await getLatestVersions(projectId) : null;
  if (!project || !versions?.prd?.sections.length) {
    await updateJob(jobId, { state: "failed", progress: 100, message: "Project not found", error: "Project or PRD missing." });
    await refundGenerationCap(sessionId, "boilerplate", "signedIn");
    return;
  }

  const versionId = crypto.randomUUID();
  const prefix = `project/${projectId}/${versionId}`;
  try {
    const descriptor = resolveTemplate(versions.stack?.backend.choice);
    const impl = getTemplateImplementation(descriptor.id);

    await updateJob(jobId, { state: "running", progress: 5, message: "Selecting template..." });
    const templateFiles = await loadTemplate(descriptor.id);

    const files = await impl.generateFillIn(
      templateFiles,
      { prompt: project.prompt, sections: versions.prd.sections },
      async (progress, message) => {
        await updateJob(jobId, { progress, message });
      }
    );

    await updateJob(jobId, { progress: 60, message: "Writing project files..." });
    const zip = await buildZip(files);
    await Promise.all([writeProjectFiles(prefix, files), writeProjectZip(prefix, zip)]);

    const validation = await runValidation(impl, files, jobId);
    if (!validation.passed) {
      await deleteProjectFiles(prefix).catch(() => {});
      await updateJob(jobId, {
        state: "failed",
        progress: 100,
        message: "Build validation failed",
        error: validation.log.slice(-MAX_LOG_CHARS),
      });
      if (validation.diskFull) await refundGenerationCap(sessionId, "boilerplate", "signedIn");
      return;
    }

    const db = getDb();
    await db.batch([
      db.insert(boilerplateVersions).values({
        id: versionId,
        projectId,
        r2Prefix: prefix,
        webContainerCompatible: descriptor.webContainerCompatible,
      }),
      db.update(projects).set({ boilerplateStale: false, updatedAt: new Date() }).where(eq(projects.id, projectId)),
    ]);

    await updateJob(jobId, {
      state: "succeeded",
      progress: 100,
      message: validation.unvalidated ? "Done (no Python interpreter found — not syntax-checked)" : "Done",
      resultRef: prefix,
      boilerplateVersionId: versionId,
      webContainerCompatible: descriptor.webContainerCompatible,
      unvalidated: validation.unvalidated ?? false,
    });
  } catch (err) {
    await deleteProjectFiles(prefix).catch(() => {});
    await updateJob(jobId, {
      state: "failed",
      progress: 100,
      message: "Generation failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
