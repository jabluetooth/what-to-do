import { NextResponse } from "next/server";
import { getOrInitGuestSession } from "@/lib/redis/guestSession";
import { listProjectFiles } from "@/lib/pipeline/projectFiles";
import { buildFileSystemTree } from "@/lib/pipeline/fileSystemTree";

/**
 * Only ever reads the tree for the session id embedded in the (httpOnly) session cookie —
 * never a client-supplied id — which is what satisfies the no-cross-session-leakage NFR here,
 * not any check on the [ref] segment in the page URL (that's display-only).
 */
export async function GET() {
  const { session } = await getOrInitGuestSession();

  if (!session.boilerplateR2Prefix) {
    return NextResponse.json({ error: "No boilerplate available for this session." }, { status: 404 });
  }

  const files = await listProjectFiles(session.boilerplateR2Prefix);
  if (files.length === 0) {
    return NextResponse.json({ error: "Boilerplate files not found." }, { status: 404 });
  }

  if (!session.boilerplateWebContainerCompatible) {
    return NextResponse.json({ compatible: false, files });
  }

  return NextResponse.json({ compatible: true, tree: buildFileSystemTree(files) });
}
