import { NextResponse } from "next/server";
import { z } from "zod";
import { count, desc, eq, inArray } from "drizzle-orm";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { getDb } from "@/lib/db/client";
import { boilerplateVersions, prdVersions, projects, stackVersions } from "@/lib/db/schema";
import { HintsSchema, PromptSchema, SectionsSchema, StackSchema } from "@/lib/mobile/schemas";
import { parseJsonBody } from "@/lib/http";

const LIST_LIMIT = 50;
/** Bounded per user; generous enough that nobody hits it organically. */
const MAX_PROJECTS_PER_USER = 200;

const CreateSchema = z.object({
  prompt: PromptSchema,
  hints: HintsSchema.optional(),
  sections: SectionsSchema,
  lowConfidence: z.boolean().default(false),
  stack: StackSchema.optional(),
});

/**
 * The phone's History (web: app/api/account/history, but bearer-auth): the user's projects,
 * newest first, each with what it has so far — a spec, a stack, generated code, a pushed repo.
 * Three queries regardless of project count.
 */
export async function GET(request: Request) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;

  const db = getDb();
  const rows = await db
    .select({ id: projects.id, prompt: projects.prompt, hints: projects.hints, createdAt: projects.createdAt, updatedAt: projects.updatedAt })
    .from(projects)
    .where(eq(projects.userId, auth.userId))
    .orderBy(desc(projects.updatedAt))
    .limit(LIST_LIMIT);
  if (rows.length === 0) return NextResponse.json({ projects: [] });

  const ids = rows.map((r) => r.id);
  const [prdRows, stackRows, codeRows] = await Promise.all([
    db.select({ projectId: prdVersions.projectId }).from(prdVersions).where(inArray(prdVersions.projectId, ids)),
    db.select({ projectId: stackVersions.projectId }).from(stackVersions).where(inArray(stackVersions.projectId, ids)),
    db
      .select({
        projectId: boilerplateVersions.projectId,
        createdAt: boilerplateVersions.createdAt,
        githubRepoUrl: boilerplateVersions.githubRepoUrl,
      })
      .from(boilerplateVersions)
      .where(inArray(boilerplateVersions.projectId, ids))
      .orderBy(desc(boilerplateVersions.createdAt)),
  ]);

  const hasPrd = new Set(prdRows.map((r) => r.projectId));
  const hasStack = new Set(stackRows.map((r) => r.projectId));
  const latestCode = new Map<string, { createdAt: Date; githubRepoUrl: string | null }>();
  for (const r of codeRows) if (!latestCode.has(r.projectId)) latestCode.set(r.projectId, r);

  return NextResponse.json({
    projects: rows.map((p) => {
      const code = latestCode.get(p.id);
      return {
        projectId: p.id,
        prompt: p.prompt,
        platform: p.hints?.platform ?? null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        hasPrd: hasPrd.has(p.id),
        hasStack: hasStack.has(p.id),
        code: code ? { createdAt: code.createdAt.toISOString(), repoUrl: code.githubRepoUrl } : null,
      };
    }),
  });
}

/** Saves a spec (and its stack, if it has one) as a project — "Keep in history", or before building code. */
export async function POST(request: Request) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;

  const parsed = await parseJsonBody(request, CreateSchema);
  if (parsed.error) return parsed.error;
  const { prompt, hints, sections, lowConfidence, stack } = parsed.data;

  const db = getDb();
  const [{ value: existing }] = await db.select({ value: count() }).from(projects).where(eq(projects.userId, auth.userId));
  if (existing >= MAX_PROJECTS_PER_USER) {
    return NextResponse.json({ error: "You've reached the project limit. Delete an old project to make room." }, { status: 409 });
  }

  const projectId = crypto.randomUUID();
  const inserts: unknown[] = [
    db.insert(prdVersions).values({ projectId, sections, lowConfidence }),
  ];
  if (stack) inserts.push(db.insert(stackVersions).values({ projectId, stack }));
  // batch() wants a compile-time tuple; which inserts run is only known at runtime.
  await db.batch([
    db.insert(projects).values({ id: projectId, userId: auth.userId, prompt, hints: hints ?? null }),
    ...inserts,
  ] as Parameters<typeof db.batch>[0]);

  return NextResponse.json({ projectId }, { status: 201 });
}
