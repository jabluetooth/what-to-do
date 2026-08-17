import { NextResponse } from "next/server";
import { getGuestSessionIdIfExists, readGuestSession } from "@/lib/redis/guestSession";
import { listProjectFiles } from "@/lib/pipeline/projectFiles";
import { buildFileSystemTree } from "@/lib/pipeline/fileSystemTree";

/**
 * Only ever reads the tree for the session id embedded in the (httpOnly) session cookie —
 * never a client-supplied id — which is what satisfies the no-cross-session-leakage NFR here,
 * not any check on the [ref] segment in the page URL (that's display-only).
 *
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

  const files = await listProjectFiles(session.boilerplateR2Prefix);
  if (files.length === 0) {
    return NextResponse.json({ error: "Boilerplate files not found." }, { status: 404 });
  }

  if (!session.boilerplateWebContainerCompatible) {
    return NextResponse.json({ compatible: false, files });
  }

  // Included so the client can echo it back in POST /api/preview/report-validation — that route
  // rejects a report whose prefix doesn't match the session's *current* boilerplate, so a tab
  // left open from a superseded generation can't misattribute a stale result to a newer one.
  return NextResponse.json({ compatible: true, tree: buildFileSystemTree(files), prefix: session.boilerplateR2Prefix });
}
