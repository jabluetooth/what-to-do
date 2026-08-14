import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { githubConnections, users } from "@/lib/db/schema";
import { encryptToken, decryptToken } from "@/lib/github/tokenCrypto";

export interface GithubConnection {
  githubLogin: string;
  accessToken: string;
  scope: string;
}

/**
 * Called from lib/auth.ts's jwt callback whenever a sign-in's returned scope includes "repo" —
 * upsert (not insert) because a user re-authorizing to grant repo access already has a row from
 * their original sign-in-scope-only connection, if they'd connected before and are refreshing.
 */
export async function upsertGithubConnection(input: {
  userId: string;
  githubLogin: string;
  accessToken: string;
  scope: string;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(githubConnections)
    .values({
      userId: input.userId,
      githubLogin: input.githubLogin,
      encryptedAccessToken: encryptToken(input.accessToken),
      scope: input.scope,
    })
    .onConflictDoUpdate({
      target: githubConnections.userId,
      set: {
        githubLogin: input.githubLogin,
        encryptedAccessToken: encryptToken(input.accessToken),
        scope: input.scope,
        updatedAt: new Date(),
      },
    });
}

export async function getGithubConnection(userId: string): Promise<GithubConnection | null> {
  const db = getDb();
  const [row] = await db.select().from(githubConnections).where(eq(githubConnections.userId, userId)).limit(1);
  if (!row) return null;
  return { githubLogin: row.githubLogin, accessToken: decryptToken(row.encryptedAccessToken), scope: row.scope };
}

export async function deleteGithubConnection(userId: string): Promise<void> {
  const db = getDb();
  await db.delete(githubConnections).where(eq(githubConnections.userId, userId));
}

export async function setAutoPushToGithub(userId: string, enabled: boolean): Promise<void> {
  const db = getDb();
  await db.update(users).set({ autoPushToGithub: enabled }).where(eq(users.id, userId));
}
