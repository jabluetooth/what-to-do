import { z } from "zod";
import { MODEL_FAST } from "@/lib/groq";
import { callGroqTool } from "@/lib/llm/callTool";

export type ModerationVerdict = "allow" | "flag" | "block";

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
            "'block' for clearly malicious asks (phishing kits, credential harvesters, spam/scraper tooling, malware, exploit tooling). 'flag' for borderline/ambiguous cases worth a human look but not launched into generation. 'allow' for ordinary app ideas, including edgy or unusual but non-malicious ones.",
        },
        reason: { type: "string", description: "One short sentence explaining the verdict." },
      },
      required: ["verdict"],
    },
  },
};

/** Pre-flight content moderation gate (PRD §7, abuse prevention) — runs before any free-text input reaches the generation pipeline. */
export async function moderateInput(text: string): Promise<ModerationResult> {
  try {
    return await callGroqTool({
      model: MODEL_FAST,
      maxTokens: 200,
      tool: MODERATION_TOOL,
      userContent: `Classify this app-idea prompt submitted to a dev-tools product that scaffolds real, runnable code from it:\n\n"""${text}"""`,
      schema: ModerationResultSchema,
    });
  } catch {
    return { verdict: "allow" };
  }
}
