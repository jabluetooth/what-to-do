import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { getDb } from "@/lib/db/client";
import { boilerplateVersions, projects } from "@/lib/db/schema";
import { getLatestVersions, getOwnedProject } from "@/lib/mobile/projects";
import { deleteProjectFiles, listProjectFiles } from "@/lib/pipeline/projectFiles";

/**
 * One project: its spec, stack, latest generated code (file paths and sizes, not contents — the
 * code viewer fetches one file at a time) and push status.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;
  const { id } = await params;

  const project = await getOwnedProject(auth.userId, id);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const { prd, stack, boilerplate } = await getLatestVersions(id);

  let files: { path: string; size: number }[] = [];
  if (boilerplate) {
    try {
      files = (await listProjectFiles(boilerplate.r2Prefix))
        .map((f) => ({ path: f.path, size: Buffer.byteLength(f.content, "utf8") }))
        .sort((a, b) => a.path.localeCompare(b.path));
    } catch (err) {
      console.error("[mobile/projects] listing files failed:", err);
    }
  }

  return NextResponse.json({
    projectId: project.id,
    prompt: project.prompt,
    hints: project.hints,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    sections: prd?.sections ?? [],
    lowConfidence: prd?.lowConfidence ?? false,
    stack,
    code: boilerplate
      ? {
          createdAt: boilerplate.createdAt.toISOString(),
          repoUrl: boilerplate.githubRepoUrl,
          pushError: boilerplate.githubPushError,
          files,
        }
      : null,
  });
}

/** Deletes the project, its versions (cascade) and every generated file set it owns. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;
  const { id } = await params;

  const project = await getOwnedProject(auth.userId, id);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const db = getDb();
  const versions = await db.select({ r2Prefix: boilerplateVersions.r2Prefix }).from(boilerplateVersions).where(eq(boilerplateVersions.projectId, id));
  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, auth.userId)));
  // Files after the rows: a failed file delete leaves orphans for the R2 lifecycle rule, never a
  // row pointing at missing files.
  await Promise.all(versions.map((v) => deleteProjectFiles(v.r2Prefix).catch(() => {})));

  return new NextResponse(null, { status: 204 });
}
