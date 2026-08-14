import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrInitGuestSession, writeGuestSession } from "@/lib/redis/guestSession";

const CATEGORIES = ["frontend", "backend", "database", "hosting", "auth"] as const;

const BodySchema = z.object({
  category: z.enum(CATEGORIES),
  choice: z.string().trim().min(1).max(200),
});

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { id: sessionId, session } = await getOrInitGuestSession();
  if (!session.stack) {
    return NextResponse.json({ error: "No stack recommendation to override for this session." }, { status: 409 });
  }

  const { category, choice } = parsed.data;
  session.stack = {
    ...session.stack,
    [category]: { choice, rationale: "Your override — no auto-generated rationale for this pick." },
  };
  session.updatedAt = new Date().toISOString();
  await writeGuestSession(sessionId, session);

  return NextResponse.json({ stack: session.stack });
}
