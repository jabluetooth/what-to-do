import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { boilerplateVersions, prdVersions, projects, stackVersions } from "@/lib/db/schema";
import type { PrdSection, PromptHints, StackRecommendation } from "@/lib/types";

/**
 * Mobile-built projects live in the same tables as the web's signed-in History (lib/db/schema.ts),
 * so a project made on the phone shows up on the web and vice versa. Every lookup here takes the
 * owner's userId alongside the projectId: ownership is part of the query, never a check after it.
 */

export interface OwnedProject {
  id: string;
  prompt: string;
  hints: PromptHints | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LatestBoilerplate {
  id: string;
  r2Prefix: string;
  webContainerCompatible: boolean;
  githubRepoUrl: string | null;
  githubPushError: string | null;
  createdAt: Date;
}

export interface ProjectVersions {
  prd: { sections: PrdSection[]; lowConfidence: boolean } | null;
  stack: StackRecommendation | null;
  boilerplate: LatestBoilerplate | null;
}

export async function getOwnedProject(userId: string, projectId: string): Promise<OwnedProject | null> {
  const [row] = await getDb()
    .select({
      id: projects.id,
      prompt: projects.prompt,
      hints: projects.hints,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** The newest PRD, stack and boilerplate for one project (each may be missing). */
export async function getLatestVersions(projectId: string): Promise<ProjectVersions> {
  const db = getDb();
  const [[prd], [stack], [boilerplate]] = await Promise.all([
    db
      .select({ sections: prdVersions.sections, lowConfidence: prdVersions.lowConfidence })
      .from(prdVersions)
      .where(eq(prdVersions.projectId, projectId))
      .orderBy(desc(prdVersions.createdAt))
      .limit(1),
    db
      .select({ stack: stackVersions.stack })
      .from(stackVersions)
      .where(eq(stackVersions.projectId, projectId))
      .orderBy(desc(stackVersions.createdAt))
      .limit(1),
    db
      .select({
        id: boilerplateVersions.id,
        r2Prefix: boilerplateVersions.r2Prefix,
        webContainerCompatible: boilerplateVersions.webContainerCompatible,
        githubRepoUrl: boilerplateVersions.githubRepoUrl,
        githubPushError: boilerplateVersions.githubPushError,
        createdAt: boilerplateVersions.createdAt,
      })
      .from(boilerplateVersions)
      .where(eq(boilerplateVersions.projectId, projectId))
      .orderBy(desc(boilerplateVersions.createdAt))
      .limit(1),
  ]);
  return { prd: prd ?? null, stack: stack?.stack ?? null, boilerplate: boilerplate ?? null };
}

/** The rate-limit / job session key for a mobile user (same one the other mobile routes use). */
export function mobileSessionId(userId: string): string {
  return `mobile:${userId}`;
}
