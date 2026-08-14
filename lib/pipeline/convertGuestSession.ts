import { getDb } from "@/lib/db/client";
import { projects, prdVersions, stackVersions, boilerplateVersions } from "@/lib/db/schema";
import {
  getGuestSessionIdIfExists,
  readGuestSession,
  claimGuestSessionForConversion,
  deleteGuestSession,
} from "@/lib/redis/guestSession";
import { copyProjectFiles, deleteProjectFiles } from "@/lib/pipeline/projectFiles";
import type { PrdSection, StackRecommendation } from "@/lib/types";

export type ConvertedProject = {
  projectId: string;
  prompt: string;
  sections: PrdSection[];
  lowConfidence: boolean;
  stack: StackRecommendation | null;
  hasBoilerplate: boolean;
};

/**
 * Migrates the caller's guest session (Redis + R2, under "guest/") into a persistent project
 * owned by userId (Postgres + R2, under "project/"). Returns null when there's nothing to
 * convert — no guest cookie, an already-converted/expired session, or a guest session that
 * never got past intake (no prompt submitted yet).
 *
 * Safe to call repeatedly / concurrently: claimGuestSessionForConversion is an atomic short-TTL
 * lock, so only one caller proceeds — a second call (or a duplicate request racing the first)
 * just finds the lock held and returns null. The guest session itself is only deleted after the
 * R2 copy and DB writes both succeed (deliberately NOT a read-and-delete up front) — a transient
 * failure partway through must leave the guest's data intact rather than losing it.
 */
export async function convertGuestSessionToProject(userId: string): Promise<ConvertedProject | null> {
  const guestId = await getGuestSessionIdIfExists();
  if (!guestId) return null;

  const session = await readGuestSession(guestId);
  if (!session || !session.prompt) return null;

  if (!(await claimGuestSessionForConversion(guestId))) return null;

  const db = getDb();
  const projectId = crypto.randomUUID();
  const prdVersionId = session.prdSections?.length ? crypto.randomUUID() : null;
  const stackVersionId = session.stack ? crypto.randomUUID() : null;
  const boilerplateVersionId = session.boilerplateR2Prefix ? crypto.randomUUID() : null;

  // Copy R2 files before committing any DB rows, so we never persist a boilerplate_version
  // pointing at files that didn't actually make it into the persistent "project/" prefix.
  let destPrefix: string | null = null;
  if (session.boilerplateR2Prefix && boilerplateVersionId) {
    destPrefix = `project/${projectId}/${boilerplateVersionId}`;
    await copyProjectFiles(session.boilerplateR2Prefix, destPrefix);
  }

  const projectInsert = db.insert(projects).values({
    id: projectId,
    userId,
    prompt: session.prompt,
    hints: session.hints ?? null,
    stackStale: session.stackStale ?? false,
    boilerplateStale: session.boilerplateStale ?? false,
  });

  // batch() wants a compile-time tuple length; the actual set of inserts is only known at
  // runtime (which stages the guest session reached), so the cast is just working around that.
  const extraInserts: unknown[] = [];
  if (prdVersionId && session.prdSections) {
    extraInserts.push(
      db.insert(prdVersions).values({
        id: prdVersionId,
        projectId,
        sections: session.prdSections,
        lowConfidence: session.prdLowConfidence ?? false,
      })
    );
  }
  if (stackVersionId && session.stack) {
    extraInserts.push(db.insert(stackVersions).values({ id: stackVersionId, projectId, stack: session.stack }));
  }
  if (boilerplateVersionId && destPrefix) {
    extraInserts.push(
      db.insert(boilerplateVersions).values({
        id: boilerplateVersionId,
        projectId,
        r2Prefix: destPrefix,
        webContainerCompatible: session.boilerplateWebContainerCompatible ?? false,
      })
    );
  }

  // If this throws (transient Neon error etc.), the guest session is still intact — the lock
  // above just expires in 60s and the user can retry (e.g. by clicking "Sign up to save" again).
  await db.batch([projectInsert, ...extraInserts] as Parameters<typeof db.batch>[0]);

  // Only remove the guest's data once it's durably persisted in Postgres/R2.
  await deleteGuestSession(guestId);
  if (session.boilerplateR2Prefix) {
    // Best-effort: the source guest/ prefix is redundant now that project/ has its own copy;
    // the R2 lifecycle rule is the backstop if this particular delete fails.
    await deleteProjectFiles(session.boilerplateR2Prefix).catch((err) => {
      console.warn("[convertGuestSession] failed to delete migrated guest R2 files:", err);
    });
  }

  return {
    projectId,
    prompt: session.prompt,
    sections: session.prdSections ?? [],
    lowConfidence: session.prdLowConfidence ?? false,
    stack: session.stack ?? null,
    hasBoilerplate: Boolean(destPrefix),
  };
}
