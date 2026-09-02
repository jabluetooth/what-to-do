import { NextResponse } from "next/server";
import { z } from "zod";
import { and, count, desc, eq } from "drizzle-orm";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { getDb } from "@/lib/db/client";
import { favorites } from "@/lib/db/schema";
import type { RandomIdea } from "@/lib/types";

/** Bounded so this can't grow unbounded per user — generous enough that no real user hits it organically. */
const MAX_FAVORITES_PER_USER = 300;

const FavoriteBodySchema = z.object({
  title: z.string().trim().min(1),
  targetUser: z.string().trim().min(1),
  description: z.string().trim().min(1),
  platformTag: z.enum(["web", "mobile"]),
}) satisfies z.ZodType<RandomIdea>;

export async function GET(request: Request) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;

  const db = getDb();
  const rows = await db
    .select()
    .from(favorites)
    .where(eq(favorites.userId, auth.userId))
    .orderBy(desc(favorites.createdAt));

  return NextResponse.json({ favorites: rows });
}

export async function POST(request: Request) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;
  const { userId } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = FavoriteBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const db = getDb();

  const [{ value: currentCount }] = await db
    .select({ value: count() })
    .from(favorites)
    .where(eq(favorites.userId, userId));
  if (currentCount >= MAX_FAVORITES_PER_USER) {
    return NextResponse.json(
      { error: `You've reached the ${MAX_FAVORITES_PER_USER}-favorite limit. Remove one to add another.` },
      { status: 409 }
    );
  }

  // Re-favoriting an already-saved title is idempotent, not an error — onConflictDoNothing hits
  // the (userId, title) unique constraint and returns no row, which is handled below by reading
  // back the existing one.
  const [inserted] = await db
    .insert(favorites)
    .values({ userId, ...parsed.data })
    .onConflictDoNothing({ target: [favorites.userId, favorites.title] })
    .returning();
  if (inserted) {
    return NextResponse.json(inserted, { status: 201 });
  }

  const [existing] = await db
    .select()
    .from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.title, parsed.data.title)))
    .limit(1);
  return NextResponse.json(existing, { status: 200 });
}
