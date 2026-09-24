import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrInitGuestSession, writeGuestSession } from "@/lib/redis/guestSession";
import {
  enforceGenerationCap,
  refundGenerationCap,
  getGenerationTier,
  RateLimitExceededError,
} from "@/lib/redis/rateLimit";
import { moderateInput } from "@/lib/llm/moderation";
import { checkVagueness } from "@/lib/llm/vagueness";
import { generatePrd } from "@/lib/llm/prd";
import { moderationUnavailableResponse, parseJsonBody } from "@/lib/http";

const BodySchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  hints: z
    .object({
      platform: z.enum(["web", "mobile"]).optional(),
      scopeSize: z.enum(["weekend", "mvp", "production"]).optional(),
      stackFamiliarity: z.string().max(300).optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, BodySchema);
  if (parsed.error) return parsed.error;
  const { prompt, hints } = parsed.data;

  const { id: sessionId, session } = await getOrInitGuestSession();

  const tier = await getGenerationTier();
  try {
    await enforceGenerationCap(sessionId, "prd", tier);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  const moderation = await moderateInput(prompt);
  if (moderation.verdict === "unavailable") {
    await refundGenerationCap(sessionId, "prd", tier);
    return moderationUnavailableResponse();
  }
  if (moderation.verdict === "block") {
    return NextResponse.json(
      { error: "This prompt can't be processed.", reason: moderation.reason },
      { status: 400 }
    );
  }

  const vagueness = await checkVagueness(prompt, hints);
  if (vagueness.vague) {
    session.prompt = prompt;
    session.hints = hints;
    session.pendingClarification = {
      question: vagueness.clarifyingQuestion ?? "Can you say more about who this is for and what it does?",
    };
    session.currentStage = "intake";
    session.updatedAt = new Date().toISOString();
    await writeGuestSession(sessionId, session);

    return NextResponse.json({
      needsClarification: true,
      clarifyingQuestion: session.pendingClarification.question,
    });
  }

  let sections;
  try {
    ({ sections } = await generatePrd({ prompt, hints }));
  } catch {
    // Platform-side failure, not a bad prompt — give the cap unit back.
    await refundGenerationCap(sessionId, "prd", tier);
    return NextResponse.json(
      { error: "Couldn't generate your PRD right now. Please try again in a moment." },
      { status: 502 }
    );
  }

  session.prompt = prompt;
  session.hints = hints;
  session.pendingClarification = null;
  session.prdSections = sections;
  session.prdLowConfidence = false;
  session.currentStage = "prd";
  session.updatedAt = new Date().toISOString();
  await writeGuestSession(sessionId, session);

  return NextResponse.json({ sessionId, sections, lowConfidence: false });
}
