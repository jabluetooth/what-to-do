import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getGithubConnectionStatus, connectionNeedsReauth } from "@/lib/github/connection";
import { getLatestGithubPushResult } from "@/lib/github/pushBoilerplate";

/**
 * Backs the header's Account modal (app/page.tsx) — a client-fetch equivalent of what
 * app/account/page.tsx server-renders, so the modal doesn't need a full navigation. That page
 * stays as-is for direct links/bookmarks; this route and the modal are purely additive.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const userId = session.user.id;
  const [userRow] = await getDb()
    .select({ autoPushToGithub: users.autoPushToGithub })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const connection = await getGithubConnectionStatus(userId);
  const lastPush = await getLatestGithubPushResult(userId);

  return NextResponse.json({
    email: session.user.email ?? null,
    name: session.user.name ?? null,
    userId,
    autoPushToGithub: userRow?.autoPushToGithub ?? false,
    connection,
    connectionNeedsReauth: connectionNeedsReauth(connection, lastPush),
    lastPush,
  });
}
