import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

/**
 * The mobile bearer token (next-auth/jwt encode(), a JWE) only carries `sub` and isn't readable
 * client-side — after the GitHub callback redirect hands the app a token, it calls this to fetch
 * the profile info (name/avatar) it needs to render post-sign-in.
 */
export async function GET(request: Request) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;

  const db = getDb();
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, image: users.image })
    .from(users)
    .where(eq(users.id, auth.userId))
    .limit(1);

  // A valid, unexpired token whose user row is gone (deleted account) shouldn't look like a
  // permissions problem — it's the same "you're not really signed in" outcome as a bad token.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(user);
}
