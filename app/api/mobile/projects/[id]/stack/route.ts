import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { getDb } from "@/lib/db/client";
import { projects, stackVersions } from "@/lib/db/schema";
import { getOwnedProject } from "@/lib/mobile/projects";
import { StackSchema } from "@/lib/mobile/schemas";
import { parseJsonBody } from "@/lib/http";

const BodySchema = z.object({ stack: StackSchema });

/**
 * Attaches a stack (from /api/mobile/stack) to a saved project as its newest stack version. Code
 * generated before this is now out of date, so the project is marked boilerplateStale.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;
  const { id } = await params;

  const parsed = await parseJsonBody(request, BodySchema);
  if (parsed.error) return parsed.error;

  const project = await getOwnedProject(auth.userId, id);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const db = getDb();
  await db.batch([
    db.insert(stackVersions).values({ projectId: id, stack: parsed.data.stack }),
    db.update(projects).set({ boilerplateStale: true, stackStale: false, updatedAt: new Date() }).where(eq(projects.id, id)),
  ]);

  return NextResponse.json({ stack: parsed.data.stack });
}
