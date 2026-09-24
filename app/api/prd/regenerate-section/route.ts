import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrInitGuestSession, writeGuestSession } from "@/lib/redis/guestSession";
import {
  enforceGenerationCap,
  refundGenerationCap,
  getGenerationTier,
  RateLimitExceededError,
} from "@/lib/redis/rateLimit";
import { PRD_SECTION_DEFS, regeneratePrdSection } from "@/lib/llm/prd";
import { replaceSection } from "@/lib/pipeline/prdSections";
import { markStackStaleIfPresent, markBoilerplateStaleIfPresent } from "@/lib/pipeline/staleness";
import { moderateInput } from "@/lib/llm/moderation";
import { moderationUnavailableResponse, parseJsonBody } from "@/lib/http";

const SECTION_KEYS = PRD_SECTION_DEFS.map((s) => s.key) as [string, ...string[]];

const BodySchema = z.object({
  sectionKey: z.enum(SECTION_KEYS),
  instructions: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, BodySchema);
  if (parsed.error) return parsed.error;

  const { id: sessionId, session } = await getOrInitGuestSession();
  if (!session.prdSections || !session.prompt) {
    return NextResponse.json({ error: "No PRD to regenerate for this session." }, { status: 409 });
  }

  const tier = await getGenerationTier();
  try {
    await enforceGenerationCap(sessionId, "prd", tier);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  // Optional free-text steering goes into the LLM prompt like any other user input.
  if (parsed.data.instructions) {
    const moderation = await moderateInput(parsed.data.instructions);
    if (moderation.verdict === "unavailable") {
      await refundGenerationCap(sessionId, "prd", tier);
      return moderationUnavailableResponse();
    }
    if (moderation.verdict === "block") {
      return NextResponse.json({ error: "These instructions can't be processed." }, { status: 400 });
    }
  }

  let newSection;
  try {
    newSection = await regeneratePrdSection({
      prompt: session.prompt,
      hints: session.hints,
      existingSections: session.prdSections,
      targetKey: parsed.data.sectionKey,
      instructions: parsed.data.instructions,
    });
  } catch {
    await refundGenerationCap(sessionId, "prd", tier);
    return NextResponse.json(
      { error: "Couldn't regenerate this section right now. Please try again in a moment." },
      { status: 502 }
    );
  }

  session.prdSections = replaceSection(session.prdSections, newSection.key, newSection.content);
  // A PRD change invalidates the boilerplate directly — it's generated from prdSections, not
  // from the stack — so this can't rely solely on the stack-change cascade below to reach it.
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
