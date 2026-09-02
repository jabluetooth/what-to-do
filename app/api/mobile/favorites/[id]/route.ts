import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { getDb } from "@/lib/db/client";
import { favorites } from "@/lib/db/schema";

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
