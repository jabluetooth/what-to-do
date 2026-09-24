import { z } from "zod";
import { MODEL_FAST, MODEL_QUALITY } from "@/lib/groq";
import { callGroqTool } from "@/lib/llm/callTool";

/** "unavailable" means the check itself couldn't run — callers must refuse, not allow. */
export type ModerationVerdict = "allow" | "flag" | "block" | "unavailable";

export interface ModerationResult {
  verdict: ModerationVerdict;
  reason?: string;
}

const ModerationResultSchema = z.object({
  verdict: z.enum(["allow", "flag", "block"]),
  // .nullish() not .optional(): models sometimes emit an explicit `null` for an unset
  // optional field rather than omitting the key, which .optional() alone would reject.
  reason: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
});

const MODERATION_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_moderation_verdict",
    description: "Classify whether a user's app-idea prompt is safe to pass into the generation pipeline.",
    parameters: {
      type: "object",
      properties: {
        verdict: {
          type: "string",
          enum: ["allow", "flag", "block"],
          description:
            "'block' for clearly malicious asks (phishing kits, credential harvesters, spam/scraper tooling, malware, exploit tooling). 'flag' for borderline/ambiguous cases — still allowed through, but logged for a human look. 'allow' for ordinary app ideas, including edgy or unusual but non-malicious ones.",
        },
        reason: { type: "string", description: "One short sentence explaining the verdict." },
      },
      required: ["verdict"],
    },
  },
};

/**
 * Pre-flight content moderation gate (PRD §7, abuse prevention) — runs before any free-text input
 * reaches the generation pipeline. Fails closed: a check that couldn't run returns "unavailable"
 * rather than "allow", since failing open would let any input through whenever the model
 * misbehaves (confirmed live that the check does fail intermittently).
 */
export async function moderateInput(text: string): Promise<ModerationResult> {
  try {
    const result = await callGroqTool({
      model: MODEL_FAST,
      fallbackModel: MODEL_QUALITY,
      maxTokens: 200,
      tool: MODERATION_TOOL,
      userContent: `Classify this app-idea prompt submitted to a dev-tools product that scaffolds real, runnable code from it:\n\n"""${text}"""`,
      schema: ModerationResultSchema,
    });
    if (result.verdict === "flag") {
      console.warn("[moderation] flagged (allowed through):", result.reason ?? "(no reason)", "|", text.slice(0, 200));
    }
    return result;
  } catch (err) {
    console.error("[moderation] check failed, refusing input:", err);
    return { verdict: "unavailable" };
  }
}

/** True only for inputs the gate positively cleared ("allow" or "flag"). */
export function passedModeration(result: ModerationResult): boolean {
  return result.verdict === "allow" || result.verdict === "flag";
}
