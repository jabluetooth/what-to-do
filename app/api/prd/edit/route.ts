import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrInitGuestSession, writeGuestSession } from "@/lib/redis/guestSession";
import { PRD_SECTION_DEFS } from "@/lib/llm/prd";
import { replaceSection } from "@/lib/pipeline/prdSections";
import { markStackStaleIfPresent, markBoilerplateStaleIfPresent } from "@/lib/pipeline/staleness";
import { moderateInput } from "@/lib/llm/moderation";
import { moderationUnavailableResponse, parseJsonBody } from "@/lib/http";

const SECTION_KEYS = PRD_SECTION_DEFS.map((s) => s.key) as [string, ...string[]];

const BodySchema = z.object({
  sectionKey: z.enum(SECTION_KEYS),
  content: z.string().trim().min(1).max(4000),
});

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, BodySchema);
  if (parsed.error) return parsed.error;

  const { id: sessionId, session } = await getOrInitGuestSession();
  if (!session.prdSections) {
    return NextResponse.json({ error: "No PRD to edit for this session." }, { status: 409 });
  }

  // Edited sections feed straight into stack and boilerplate generation, so they get the same
  // gate as the original prompt — otherwise an edit is a way around it.
  const moderation = await moderateInput(parsed.data.content);
  if (moderation.verdict === "unavailable") return moderationUnavailableResponse();
  if (moderation.verdict === "block") {
    return NextResponse.json({ error: "This edit can't be saved.", reason: moderation.reason }, { status: 400 });
  }

  session.prdSections = replaceSection(session.prdSections, parsed.data.sectionKey, parsed.data.content);
  // A PRD edit invalidates the boilerplate directly — it's generated from prdSections, not from
  // the stack — so this can't rely solely on the stack-change cascade below to reach it.
  markStackStaleIfPresent(session);
  markBoilerplateStaleIfPresent(session);
  session.updatedAt = new Date().toISOString();
  await writeGuestSession(sessionId, session);

  return NextResponse.json({
    sections: session.prdSections,
    stackStale: session.stackStale ?? false,
    boilerplateStale: session.boilerplateStale ?? false,
  });
}
