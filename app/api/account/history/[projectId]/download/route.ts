import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { projects, boilerplateVersions } from "@/lib/db/schema";
import { readProjectZip } from "@/lib/pipeline/projectFiles";

/**
 * The signed-in equivalent of GET /api/boilerplate/download, which only ever reads the *active
 * guest session's* boilerplate. History needs to download any of the user's own saved projects,
 * so this is scoped by projectId + an explicit ownership check instead of a session cookie.
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
    .select({ r2Prefix: boilerplateVersions.r2Prefix })
    .from(boilerplateVersions)
    .where(eq(boilerplateVersions.projectId, projectId))
    .orderBy(desc(boilerplateVersions.createdAt))
    .limit(1);
  if (!latest) {
    return NextResponse.json({ error: "No boilerplate available for this project." }, { status: 404 });
  }

  const zip = await readProjectZip(latest.r2Prefix);
  if (!zip) {
    return NextResponse.json({ error: "Boilerplate archive not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="boilerplate.zip"',
    },
  });
}
