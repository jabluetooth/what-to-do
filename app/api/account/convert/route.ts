import { NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { convertGuestSessionToProject } from "@/lib/pipeline/convertGuestSession";
import { maybeAutoPushBoilerplate } from "@/lib/github/pushBoilerplate";

/**
 * Fires once per sign-in (client calls this right after detecting an authenticated session) to
 * migrate any in-progress guest work into a persistent project. A no-op, not an error, when
 * there's nothing to convert — most sign-ins won't have a guest session waiting.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const converted = await convertGuestSessionToProject(session.user.id);

    // Runs after responding — a repo create + several file-push API calls to GitHub shouldn't
    // hold up the conversion response, and maybeAutoPushBoilerplate never throws (best-effort,
    // records its own error on the row rather than failing the request).
    if (converted?.boilerplateVersionId && converted.boilerplateR2Prefix) {
      const userId = session.user.id;
      const { prompt, boilerplateVersionId, boilerplateR2Prefix } = converted;
      after(() => maybeAutoPushBoilerplate({ userId, prompt, boilerplateVersionId, r2Prefix: boilerplateR2Prefix }));
    }

    return NextResponse.json({ project: converted });
  } catch (err) {
    console.error("[account/convert] conversion failed:", err);
    // The guest session is untouched on failure (see convertGuestSessionToProject) — safe to
    // retry once the transient error (Neon/R2 blip) clears, so say so rather than a bare 500.
    return NextResponse.json(
      { error: "Couldn't save your project right now. Your guest session is safe — try again shortly." },
      { status: 503 }
    );
  }
}
