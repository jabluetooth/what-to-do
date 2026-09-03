import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { getDb } from "@/lib/db/client";
import { favorites } from "@/lib/db/schema";
import { PRESET_TAGS } from "@/lib/types";

const FavoritePatchSchema = z.object({
  notes: z.string().trim().max(2000).nullable().optional(),
  tags: z.array(z.enum(PRESET_TAGS)).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = FavoritePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.notes === undefined && parsed.data.tags === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { id } = await params;
  const db = getDb();

  // Same ownership-baked-into-the-WHERE pattern as DELETE below.
  const [updated] = await db
    .update(favorites)
    .set(parsed.data)
    .where(and(eq(favorites.id, id), eq(favorites.userId, auth.userId)))
    .returning();
  if (!updated) {
    return NextResponse.json({ error: "Favorite not found." }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;

  const { id } = await params;
  const db = getDb();

  // Ownership check baked into the WHERE, not a separate read-then-check — a favorite that
  // exists but belongs to someone else must look identical to one that doesn't exist at all.
  const [deleted] = await db
    .delete(favorites)
    .where(and(eq(favorites.id, id), eq(favorites.userId, auth.userId)))
    .returning({ id: favorites.id });
  if (!deleted) {
    return NextResponse.json({ error: "Favorite not found." }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
