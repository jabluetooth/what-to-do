import { NextResponse } from "next/server";
import { z } from "zod";
import { getGuestSessionIdIfExists, readGuestSession, writeGuestSession } from "@/lib/redis/guestSession";

const BodySchema = z.object({
  verified: z.boolean(),
  /** The R2 prefix this report is about — see the prefix-mismatch check below for why this matters. */
  prefix: z.string().min(1),
});

/**
 * Called by app/preview/[ref]/page.tsx once its WebContainer boot actually finishes (success or
 * failure) — this is the only place a real install+dev-server run ever happens now (see
 * lib/sandbox/validateSyntax.ts's doc comment for why the server-side check stopped doing that
 * itself). Session-scoped via the same httpOnly-cookie pattern as every other guest route, not
 * the [ref] URL segment.
 *
 * Read-only-with-a-side-effect, so uses getGuestSessionIdIfExists (never creates a session)
 * rather than getOrInitGuestSession — a cookie-less caller shouldn't be able to mint free Redis
 * keys just by POSTing here. Also checks the reported prefix against the session's *current*
 * boilerplateR2Prefix: without that, a preview tab left open from a superseded generation could
 * report a stale result against whatever the session's boilerplate happens to be by the time its
 * slow WebContainer boot finally finishes — this field is client-reported either way (see
 * lib/types.ts), but it should at least be reported about the right artifact.
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

  const sessionId = await getGuestSessionIdIfExists();
  const session = sessionId ? await readGuestSession(sessionId) : null;

  if (!session?.boilerplateR2Prefix) {
    return NextResponse.json({ error: "No boilerplate available for this session." }, { status: 409 });
  }

  if (session.boilerplateR2Prefix !== parsed.data.prefix) {
    return NextResponse.json({ error: "This report is about a superseded boilerplate." }, { status: 409 });
  }

  session.boilerplateBuildVerified = parsed.data.verified;
  session.updatedAt = new Date().toISOString();
  await writeGuestSession(sessionId!, session);

  return NextResponse.json({ ok: true });
}
