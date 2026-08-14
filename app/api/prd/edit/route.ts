import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrInitGuestSession, writeGuestSession } from "@/lib/redis/guestSession";
import { PRD_SECTION_DEFS } from "@/lib/llm/prd";
import { replaceSection } from "@/lib/pipeline/prdSections";
import { markStackStaleIfPresent } from "@/lib/pipeline/staleness";

const SECTION_KEYS = PRD_SECTION_DEFS.map((s) => s.key) as [string, ...string[]];

const BodySchema = z.object({
  sectionKey: z.enum(SECTION_KEYS),
  content: z.string().trim().min(1).max(4000),
});

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { id: sessionId, session } = await getOrInitGuestSession();
  if (!session.prdSections) {
    return NextResponse.json({ error: "No PRD to edit for this session." }, { status: 409 });
  }

  session.prdSections = replaceSection(session.prdSections, parsed.data.sectionKey, parsed.data.content);
  markStackStaleIfPresent(session);
  session.updatedAt = new Date().toISOString();
  await writeGuestSession(sessionId, session);

  return NextResponse.json({ sections: session.prdSections, stackStale: session.stackStale ?? false });
}
