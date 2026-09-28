import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMobileUserId } from "@/lib/mobileAuth";
import { enforceGenerationCap, refundGenerationCap, RateLimitExceededError } from "@/lib/redis/rateLimit";
import { moderateInput } from "@/lib/llm/moderation";
import { pickStack } from "@/lib/pipeline/stackMatrix";
import { generateStackRationale } from "@/lib/llm/stack";
import { moderationUnavailableResponse, parseJsonBody } from "@/lib/http";
import type { StackRecommendation } from "@/lib/types";

const BodySchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  /** The PRD the app got back from /api/mobile/prd — grounds the rationale. */
  sections: z
    .array(
      z.object({
        key: z.string().max(60),
        title: z.string().max(120),
        content: z.string().max(6000),
      })
    )
    .min(1)
    .max(12),
  hints: z
    .object({
      platform: z.enum(["web", "mobile"]).optional(),
      scopeSize: z.enum(["weekend", "mvp", "production"]).optional(),
      stackFamiliarity: z.string().max(300).optional(),
    })
    .optional(),
});

/**
 * Mobile's stack step (web: app/api/stack/generate), stateless: the app sends the prompt and the
 * PRD it already has. Picks come from the curated matrix; the LLM only writes the "why". The
 * sections are client-supplied, so they go through moderation along with the prompt before
 * reaching the model.
 */
export async function POST(request: Request) {
  const auth = await requireMobileUserId(request);
  if (auth.error) return auth.error;
  const sessionId = `mobile:${auth.userId}`;
  const tier = "signedIn";

  const parsed = await parseJsonBody(request, BodySchema);
  if (parsed.error) return parsed.error;
  const { prompt, sections, hints } = parsed.data;

  try {
    await enforceGenerationCap(sessionId, "stack", tier);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  const moderation = await moderateInput(`${prompt}\n\n${sections.map((s) => s.content).join("\n\n")}`.slice(0, 8000));
  if (moderation.verdict === "unavailable") {
    await refundGenerationCap(sessionId, "stack", tier);
    return moderationUnavailableResponse();
  }
  if (moderation.verdict === "block") {
    return NextResponse.json({ error: "This prompt can't be processed.", reason: moderation.reason }, { status: 400 });
  }

  const picks = pickStack(hints);
  try {
    const rationale = await generateStackRationale({ prompt, sections, picks });
    const stack: StackRecommendation = {
      frontend: { choice: picks.frontend, rationale: rationale.frontend },
      backend: { choice: picks.backend, rationale: rationale.backend },
      database: { choice: picks.database, rationale: rationale.database },
      hosting: { choice: picks.hosting, rationale: rationale.hosting },
      auth: { choice: picks.auth, rationale: rationale.auth },
    };
    return NextResponse.json({ stack });
  } catch {
    await refundGenerationCap(sessionId, "stack", tier);
    return NextResponse.json(
      { error: "Couldn't recommend a stack right now. Please try again in a moment." },
      { status: 502 }
    );
  }
}
