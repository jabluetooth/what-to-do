import { NextResponse } from "next/server";
import { inArray, eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { projects, prdVersions, stackVersions, boilerplateVersions } from "@/lib/db/schema";
import type { PrdSection, StackRecommendation } from "@/lib/types";

const HISTORY_LIMIT = 20;

export interface HistoryProject {
  projectId: string;
  prompt: string;
  createdAt: string;
  sections: PrdSection[];
  lowConfidence: boolean;
  stack: StackRecommendation | null;
  hasBoilerplate: boolean;
}

/**
 * Backs the header's History panel (signed-in users only). Each project gets at most one PRD/
 * stack/boilerplate version today — the only way a project exists at all is the one-time guest-
 * >account conversion (see lib/pipeline/convertGuestSession.ts), there's no edit/regenerate path
 * for signed-in projects yet — but this still takes the *latest* row per project rather than
 * assuming exactly one, so it keeps working once that changes instead of silently picking an
 * arbitrary version. Three queries total regardless of project count (IN-list + group-by-first-
 * seen in JS) rather than one round-trip per project.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const db = getDb();
  const userProjects = await db
    .select({ id: projects.id, prompt: projects.prompt, createdAt: projects.createdAt })
    .from(projects)
    .where(eq(projects.userId, session.user.id))
    .orderBy(desc(projects.updatedAt))
    .limit(HISTORY_LIMIT);

  if (userProjects.length === 0) {
    return NextResponse.json({ projects: [] satisfies HistoryProject[] });
  }

  const projectIds = userProjects.map((p) => p.id);

  const [prdRows, stackRows, boilerplateRows] = await Promise.all([
    db
      .select({ projectId: prdVersions.projectId, sections: prdVersions.sections, lowConfidence: prdVersions.lowConfidence })
      .from(prdVersions)
      .where(inArray(prdVersions.projectId, projectIds))
      .orderBy(desc(prdVersions.createdAt)),
    db
      .select({ projectId: stackVersions.projectId, stack: stackVersions.stack })
      .from(stackVersions)
      .where(inArray(stackVersions.projectId, projectIds))
      .orderBy(desc(stackVersions.createdAt)),
    db
      .select({ projectId: boilerplateVersions.projectId })
      .from(boilerplateVersions)
      .where(inArray(boilerplateVersions.projectId, projectIds))
      .orderBy(desc(boilerplateVersions.createdAt)),
  ]);

  // Each list is ordered newest-first, so the first entry seen per projectId is the latest.
  const latestPrd = new Map<string, { sections: PrdSection[]; lowConfidence: boolean }>();
  for (const row of prdRows) if (!latestPrd.has(row.projectId)) latestPrd.set(row.projectId, row);
  const latestStack = new Map<string, StackRecommendation>();
  for (const row of stackRows) if (!latestStack.has(row.projectId)) latestStack.set(row.projectId, row.stack);
  const hasBoilerplate = new Set(boilerplateRows.map((row) => row.projectId));

  const result: HistoryProject[] = userProjects.map((p) => ({
    projectId: p.id,
    prompt: p.prompt,
    createdAt: p.createdAt.toISOString(),
    sections: latestPrd.get(p.id)?.sections ?? [],
    lowConfidence: latestPrd.get(p.id)?.lowConfidence ?? false,
    stack: latestStack.get(p.id) ?? null,
    hasBoilerplate: hasBoilerplate.has(p.id),
  }));

  return NextResponse.json({ projects: result });
}
