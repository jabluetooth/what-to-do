import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { enforceGenerationCap, refundGenerationCap, RateLimitExceededError } from "@/lib/redis/rateLimit";
import { moderateInput } from "@/lib/llm/moderation";
import { checkVagueness } from "@/lib/llm/vagueness";
import { generatePrd } from "@/lib/llm/prd";
import { moderationUnavailableResponse, parseJsonBody } from "@/lib/http";

const HintsSchema = z.object({
  platform: z.enum(["web", "mobile"]).optional(),
  scopeSize: z.enum(["weekend", "mvp", "production"]).optional(),
  stackFamiliarity: z.string().max(300).optional(),
});

const BodySchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  hints: HintsSchema.optional(),
  /** The answer to the one clarifying question a vague prompt gets (PRD §6.1). */
  clarification: z
    .object({
      question: z.string().trim().min(1).max(500),
      answer: z.string().trim().min(1).max(1000),
    })
    .optional(),
});

/**
 * Mobile's PRD step: app/api/prompt/submit + app/api/prompt/clarify folded into one bearer-auth
 * route. It's stateless (no guest session): a vague prompt comes back with its clarifying
 * question, and the app sends the prompt again with `clarification` filled in. Same moderation,
 * vagueness check, generator, cap and refund-on-platform-failure policy as the web routes.
 */
export async function POST(request: Request) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;
  const sessionId = `mobile:${auth.userId}`;
  const tier = "signedIn";

  const parsed = await parseJsonBody(request, BodySchema);
  if (parsed.error) return parsed.error;
  const { prompt, hints, clarification } = parsed.data;

  try {
    await enforceGenerationCap(sessionId, "prd", tier);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  // Both the prompt and any clarification answer are free text (PRD §7).
  for (const text of clarification ? [prompt, clarification.answer] : [prompt]) {
    const moderation = await moderateInput(text);
    if (moderation.verdict === "unavailable") {
      await refundGenerationCap(sessionId, "prd", tier);
      return moderationUnavailableResponse();
    }
    if (moderation.verdict === "block") {
      return NextResponse.json({ error: "This prompt can't be processed.", reason: moderation.reason }, { status: 400 });
    }
  }

  let lowConfidence = false;
  if (!clarification) {
    const vagueness = await checkVagueness(prompt, hints);
    if (vagueness.vague) {
      return NextResponse.json({
        needsClarification: true,
        clarifyingQuestion: vagueness.clarifyingQuestion ?? "Can you say more about who this is for and what it does?",
      });
    }
  } else {
    // Only one clarifying round: if the follow-up is still thin, generate anyway and flag it.
    const followUp = `${prompt}\n\n(Clarification Q: ${clarification.question}\nA: ${clarification.answer})`;
    lowConfidence = (await checkVagueness(followUp, hints)).vague;
  }

  try {
    const { sections } = await generatePrd({ prompt, hints, clarification, lowConfidence });
    return NextResponse.json({ sections, lowConfidence });
  } catch {
    // Platform-side failure, not a bad prompt — give the cap unit back.
    await refundGenerationCap(sessionId, "prd", tier);
    return NextResponse.json(
      { error: "Couldn't write your PRD right now. Please try again in a moment." },
      { status: 502 }
    );
  }
}
