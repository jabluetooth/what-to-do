import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrInitGuestSession, writeGuestSession } from "@/lib/redis/guestSession";

const BodySchema = z.object({
  verified: z.boolean(),
});

/**
 * Called by app/preview/[ref]/page.tsx once its WebContainer boot actually finishes (success or
 * failure) — this is the only place a real install+dev-server run ever happens now (see
 * lib/sandbox/validateSyntax.ts's doc comment for why the server-side check stopped doing that
 * itself). Session-scoped via the same httpOnly-cookie pattern as every other guest route, not
 * the [ref] URL segment.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  let body: unknown;
  try {
    body = rawBody ? JSON.parse(rawBody) : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { id: sessionId, session } = await getOrInitGuestSession();

  if (!session.boilerplateR2Prefix) {
    return NextResponse.json({ error: "No boilerplate available for this session." }, { status: 409 });
  }

  session.boilerplateBuildVerified = parsed.data.verified;
  session.updatedAt = new Date().toISOString();
  await writeGuestSession(sessionId, session);

  return NextResponse.json({ ok: true });
}
