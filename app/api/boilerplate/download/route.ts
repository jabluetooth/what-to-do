import { NextResponse } from "next/server";
import { getGuestSessionIdIfExists, readGuestSession } from "@/lib/redis/guestSession";
import { readProjectZip } from "@/lib/pipeline/projectFiles";

/**
 * Read-only, so uses getGuestSessionIdIfExists (never creates a session) rather than
 * getOrInitGuestSession — a cookie-less caller minting a fresh 45-minute Redis key on every
 * request to a route that can only ever 404 for them is free unbounded Redis usage on an
 * unauthenticated endpoint.
 */
export async function GET() {
  const sessionId = await getGuestSessionIdIfExists();
  const session = sessionId ? await readGuestSession(sessionId) : null;

  if (!session?.boilerplateR2Prefix) {
    return NextResponse.json({ error: "No boilerplate available for this session." }, { status: 404 });
  }

  const zip = await readProjectZip(session.boilerplateR2Prefix);
  if (!zip) {
    return NextResponse.json({ error: "Boilerplate archive not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="boilerplate.zip"',
    },
  });
}
