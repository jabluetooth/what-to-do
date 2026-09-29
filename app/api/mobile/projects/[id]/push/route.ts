import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { getDb } from "@/lib/db/client";
import { boilerplateVersions } from "@/lib/db/schema";
import { getLatestVersions, getOwnedProject } from "@/lib/mobile/projects";
import { getGithubConnection, hasRepoScope } from "@/lib/github/connection";
import { createRepo, pushFiles, GithubApiError } from "@/lib/github/client";
import { listProjectFiles } from "@/lib/pipeline/projectFiles";
import { slugify } from "@/lib/pipeline/slugify";
import { parseJsonBody } from "@/lib/http";

/** Creating a repo plus one commit per file (~10 files) can take a while. */
export const maxDuration = 60;

const MAX_ERROR_CHARS = 500;
const BodySchema = z.object({ private: z.boolean().default(true) });

/**
 * Pushes a project's latest generated code to a new GitHub repo (web: the post-conversion
 * auto-push in lib/github/pushBoilerplate.ts, but on demand). Needs the one-time repo grant from
 * /api/mobile/github/connect; without it this answers 409 with needsGithubConnect so the app can
 * run that flow and retry. Pushing the same version twice returns the existing repo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;
  const { id } = await params;

  const parsed = await parseJsonBody(request, BodySchema);
  if (parsed.error) return parsed.error;

  const project = await getOwnedProject(auth.userId, id);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const { boilerplate } = await getLatestVersions(id);
  if (!boilerplate) return NextResponse.json({ error: "Generate the code before pushing." }, { status: 409 });
  if (boilerplate.githubRepoUrl) return NextResponse.json({ repoUrl: boilerplate.githubRepoUrl, alreadyPushed: true });

  let connection;
  try {
    connection = await getGithubConnection(auth.userId);
  } catch {
    connection = null; // stored token can't be decrypted: treat as not connected
  }
  if (!connection || !hasRepoScope(connection.scope)) {
    return NextResponse.json({ error: "Connect GitHub to push.", needsGithubConnect: true }, { status: 409 });
  }

  const db = getDb();
  let repoUrl: string | null = null;
  try {
    const files = await listProjectFiles(boilerplate.r2Prefix);
    // A rolled idea's prompt is "Title (who): description"; name the repo after the title.
    const title = project.prompt.split(" (")[0] || project.prompt;
    const repo = await createRepo(connection.accessToken, `whattodo-${slugify(title)}`, project.prompt, parsed.data.private);
    repoUrl = repo.htmlUrl;
    // Recorded before pushing files so a partial push still leaves a link to the repo.
    await db.update(boilerplateVersions).set({ githubRepoUrl: repoUrl, githubPushError: null }).where(eq(boilerplateVersions.id, boilerplate.id));
    await pushFiles(connection.accessToken, repo.owner, repo.name, files);
    return NextResponse.json({ repoUrl });
  } catch (err) {
    const message = err instanceof GithubApiError ? err.message : err instanceof Error ? err.message : String(err);
    console.error("[mobile/push] failed:", message);
    await db
      .update(boilerplateVersions)
      .set({ githubPushError: message.slice(0, MAX_ERROR_CHARS) })
      .where(eq(boilerplateVersions.id, boilerplate.id))
      .catch(() => {});
    // GitHub rejecting the token itself means the grant was revoked: reconnect, then retry.
    if (err instanceof GithubApiError && err.status === 401) {
      return NextResponse.json({ error: "GitHub access expired. Connect GitHub again.", needsGithubConnect: true }, { status: 409 });
    }
    return NextResponse.json(
      { error: repoUrl ? "The repo was created, but pushing the files failed." : "Couldn't create the repo on GitHub.", repoUrl },
      { status: 502 }
    );
  }
}
