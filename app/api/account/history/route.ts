import { NextResponse } from "next/server";
import { inArray, eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { projects, prdVersions, stackVersions, boilerplateVersions } from "@/lib/db/schema";
import type { PlatformHint, PrdSection, StackRecommendation } from "@/lib/types";

/** A dedicated browsing/search page (app/history) rather than the old compact modal, so a more
 *  generous cap is worth it — still bounded, not unpaginated. */
const HISTORY_LIMIT = 50;

export interface HistoryProject {
  projectId: string;
  prompt: string;
  createdAt: string;
  sections: PrdSection[];
  lowConfidence: boolean;
  stack: StackRecommendation | null;
  hasBoilerplate: boolean;
  /** False whenever hasBoilerplate is false too — WebContainers can't run every generated stack
   *  (see lib/pipeline template metadata), so this is what the history UI uses to decide between
   *  showing a working Preview button and a "not available" fallback. */
  webContainerCompatible: boolean;
  /** Only present when the original prompt's optional hints included one — most historical
   *  entries won't have this, since it's opt-in on the intake form. */
  platform: PlatformHint | null;
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
    .select({ id: projects.id, prompt: projects.prompt, createdAt: projects.createdAt, hints: projects.hints })
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
      .select({ projectId: boilerplateVersions.projectId, webContainerCompatible: boilerplateVersions.webContainerCompatible })
      .from(boilerplateVersions)
      .where(inArray(boilerplateVersions.projectId, projectIds))
      .orderBy(desc(boilerplateVersions.createdAt)),
  ]);

  // Each list is ordered newest-first, so the first entry seen per projectId is the latest.
  const latestPrd = new Map<string, { sections: PrdSection[]; lowConfidence: boolean }>();
  for (const row of prdRows) if (!latestPrd.has(row.projectId)) latestPrd.set(row.projectId, row);
  const latestStack = new Map<string, StackRecommendation>();
  for (const row of stackRows) if (!latestStack.has(row.projectId)) latestStack.set(row.projectId, row.stack);
  const latestBoilerplate = new Map<string, boolean>();
  for (const row of boilerplateRows) if (!latestBoilerplate.has(row.projectId)) latestBoilerplate.set(row.projectId, row.webContainerCompatible);

  const result: HistoryProject[] = userProjects.map((p) => ({
    projectId: p.id,
    prompt: p.prompt,
    createdAt: p.createdAt.toISOString(),
    sections: latestPrd.get(p.id)?.sections ?? [],
    lowConfidence: latestPrd.get(p.id)?.lowConfidence ?? false,
    stack: latestStack.get(p.id) ?? null,
    hasBoilerplate: latestBoilerplate.has(p.id),
    webContainerCompatible: latestBoilerplate.get(p.id) ?? false,
    platform: p.hints?.platform ?? null,
  }));

  return NextResponse.json({ projects: result });
}
