import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { projects, boilerplateVersions } from "@/lib/db/schema";
import { listProjectFiles } from "@/lib/pipeline/projectFiles";
import { buildFileSystemTree } from "@/lib/pipeline/fileSystemTree";

/**
 * The signed-in, project-scoped counterpart to GET /api/preview/bootstrap (which only ever reads
 * the *active guest session's* boilerplate via its cookie). Ownership is checked explicitly here
 * since the projectId comes from the URL, not an httpOnly session cookie — see
 * app/preview/project/[projectId]/page.tsx, the client that calls this.
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { projectId } = await params;
  const db = getDb();

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const [latest] = await db
    .select({ r2Prefix: boilerplateVersions.r2Prefix, webContainerCompatible: boilerplateVersions.webContainerCompatible })
    .from(boilerplateVersions)
    .where(eq(boilerplateVersions.projectId, projectId))
    .orderBy(desc(boilerplateVersions.createdAt))
    .limit(1);
  if (!latest) {
    return NextResponse.json({ error: "No boilerplate available for this project." }, { status: 404 });
  }

  const files = await listProjectFiles(latest.r2Prefix);
  if (files.length === 0) {
    return NextResponse.json({ error: "Boilerplate files not found." }, { status: 404 });
  }

  if (!latest.webContainerCompatible) {
    return NextResponse.json({ compatible: false, files });
  }

  return NextResponse.json({ compatible: true, tree: buildFileSystemTree(files), prefix: latest.r2Prefix });
}
