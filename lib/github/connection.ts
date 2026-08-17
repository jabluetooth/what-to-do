import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { githubConnections, users } from "@/lib/db/schema";
import { encryptToken, decryptToken } from "@/lib/github/tokenCrypto";
import { revokeGithubToken } from "@/lib/github/client";

export interface GithubConnection {
  githubLogin: string;
  accessToken: string;
  scope: string;
}

export interface GithubConnectionStatus {
  githubLogin: string;
  scope: string;
  /** False when the stored token can't be decrypted (e.g. GITHUB_TOKEN_ENCRYPTION_KEY was rotated) — the row exists but is unusable, distinct from no connection at all. */
  usable: boolean;
}

/**
 * Exact-token scope check, not substring: GitHub's OAuth scope string is space-delimited, and
 * "repo" is a substring of "public_repo"/"repo:status"/"repo_deployment"/"admin:repo_hook" —
 * `.includes("repo")` would treat all of those as full repo-write access, which they aren't.
 */
export function hasRepoScope(scope: string | undefined | null): boolean {
  return scope?.split(/[\s,]+/).includes("repo") ?? false;
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

/**
 * Status-only variant for display (app/account/page.tsx) that never throws on a bad ciphertext —
 * getGithubConnection's decryptToken() throwing there would 500 the entire account page,
 * including the Disconnect button that's the only way to actually recover from that exact
 * situation. Doesn't return the token itself; callers needing it (pushBoilerplate,
 * disconnectGithub) still go through getGithubConnection/direct row access.
 */
export async function getGithubConnectionStatus(userId: string): Promise<GithubConnectionStatus | null> {
  const db = getDb();
  const [row] = await db.select().from(githubConnections).where(eq(githubConnections.userId, userId)).limit(1);
  if (!row) return null;
  try {
    decryptToken(row.encryptedAccessToken);
    return { githubLogin: row.githubLogin, scope: row.scope, usable: true };
  } catch {
    return { githubLogin: row.githubLogin, scope: row.scope, usable: false };
  }
}

/**
 * Revokes the grant at GitHub before removing the local row — deleteGithubConnection alone left
 * a live, indefinitely-valid GitHub token behind with no local record to ever revoke it by,
 * confirmed as the highest-severity finding of the follow-up audit. Best-effort on the revoke:
 * if the token can't be decrypted (same rotated-key scenario getGithubConnectionStatus handles)
 * or GitHub's API call fails, the local row is still removed — a local-only disconnect is worse
 * than a real one but strictly better than the button silently doing nothing.
 */
export async function disconnectGithub(userId: string): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(githubConnections).where(eq(githubConnections.userId, userId)).limit(1);
  if (row) {
    try {
      const token = decryptToken(row.encryptedAccessToken);
      await revokeGithubToken(token);
    } catch (err) {
      console.error("[github] failed to revoke token on disconnect (local record still removed):", err);
    }
  }
  await db.delete(githubConnections).where(eq(githubConnections.userId, userId));
}

export async function setAutoPushToGithub(userId: string, enabled: boolean): Promise<void> {
  const db = getDb();
  await db.update(users).set({ autoPushToGithub: enabled }).where(eq(users.id, userId));
}
