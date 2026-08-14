import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrInitGuestSession, writeGuestSession } from "@/lib/redis/guestSession";
import { enforceGenerationCap, RateLimitExceededError } from "@/lib/redis/rateLimit";
import { moderateInput } from "@/lib/llm/moderation";
import { checkVagueness } from "@/lib/llm/vagueness";
import { generatePrd } from "@/lib/llm/prd";

const BodySchema = z.object({ answer: z.string().trim().min(1).max(1000) });

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { id: sessionId, session } = await getOrInitGuestSession();

  if (!session.pendingClarification || !session.prompt) {
    return NextResponse.json({ error: "No pending clarification for this session." }, { status: 409 });
  }

  try {
    await enforceGenerationCap(sessionId, "prd");
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  const question = session.pendingClarification.question;
  const answer = parsed.data.answer;

  // Clarification answers are free text same as the initial prompt (PRD §7) — the vagueness
  // recheck below only judges specificity, not safety, so this must run independently.
  const moderation = await moderateInput(answer);
  if (moderation.verdict === "block") {
    return NextResponse.json(
      { error: "This prompt can't be processed.", reason: moderation.reason },
      { status: 400 }
    );
  }

  // Only one clarifying round happens (PRD §6.1): if the follow-up is still thin, proceed
  // with best-effort generation and flag it low-confidence rather than asking again.
  const followUpContext = `${session.prompt}\n\n(Clarification Q: ${question}\nA: ${answer})`;
  const recheck = await checkVagueness(followUpContext, session.hints);

  let sections;
  try {
    ({ sections } = await generatePrd({
      prompt: session.prompt,
      hints: session.hints,
      clarification: { question, answer },
      lowConfidence: recheck.vague,
    }));
  } catch {
    return NextResponse.json(
      { error: "Couldn't generate your PRD right now. Please try again in a moment." },
      { status: 502 }
    );
  }

  session.pendingClarification = null;
  session.prdSections = sections;
  session.prdLowConfidence = recheck.vague;
  session.currentStage = "prd";
  session.updatedAt = new Date().toISOString();
  await writeGuestSession(sessionId, session);

  return NextResponse.json({ sessionId, sections, lowConfidence: recheck.vague });
}
