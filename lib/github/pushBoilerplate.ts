import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users, boilerplateVersions } from "@/lib/db/schema";
import { getGithubConnection } from "@/lib/github/connection";
import { createRepo, pushFiles, GithubApiError } from "@/lib/github/client";
import { listProjectFiles } from "@/lib/pipeline/projectFiles";

const MAX_ERROR_CHARS = 500;

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    // The slice above can land right after a run of hyphens, leaving one dangling — trim again.
    .replace(/-+$/g, "");
  return slug || "app";
}

/**
 * Best-effort, called right after guest->account conversion (the only real signed-in touchpoint
 * today — see /api/account/convert). Never throws: a failed push shouldn't undo or block a
 * successful conversion, which is why errors are recorded on the row (githubPushError) rather
 * than propagated. No-ops quietly when the user hasn't opted in or hasn't granted repo access —
 * both are the normal case for most users, not an error condition. The opt-in checks and the
 * error-recording write are both inside the try/catch too — getGithubConnection can throw (a
 * misconfigured GITHUB_TOKEN_ENCRYPTION_KEY, or malformed stored ciphertext), and that must
 * still be caught to hold the "never throws" contract this function is called under via after().
 */
export async function maybeAutoPushBoilerplate(input: {
  userId: string;
  prompt: string;
  boilerplateVersionId: string;
  r2Prefix: string;
}): Promise<void> {
  const db = getDb();

  try {
    const [user] = await db.select({ autoPushToGithub: users.autoPushToGithub }).from(users).where(eq(users.id, input.userId)).limit(1);
    if (!user?.autoPushToGithub) return;

    const connection = await getGithubConnection(input.userId);
    if (!connection) return;

    const files = await listProjectFiles(input.r2Prefix);
    const repoName = `whattodo-${slugify(input.prompt)}`;
    const repo = await createRepo(connection.accessToken, repoName, input.prompt);

    // Recorded immediately after the repo is created (before pushing files) so a partial
    // pushFiles failure below still leaves a usable link to the (possibly incomplete) repo,
    // instead of an orphaned repo the app has no reference to at all.
    await db
      .update(boilerplateVersions)
      .set({ githubRepoUrl: repo.htmlUrl, githubPushError: null })
      .where(eq(boilerplateVersions.id, input.boilerplateVersionId));

    await pushFiles(connection.accessToken, repo.owner, repo.name, files);
  } catch (err) {
    const message = err instanceof GithubApiError ? err.message : err instanceof Error ? err.message : String(err);
    console.error("[pushBoilerplate] auto-push failed:", message);
    try {
      await db
        .update(boilerplateVersions)
        .set({ githubPushError: message.slice(0, MAX_ERROR_CHARS) })
        .where(eq(boilerplateVersions.id, input.boilerplateVersionId));
    } catch (writeErr) {
      // Genuinely nothing more to do here — swallow rather than let a failure to *record* the
      // error escape this "never throws" function.
      console.error("[pushBoilerplate] failed to record push error on row:", writeErr);
    }
  }
}
