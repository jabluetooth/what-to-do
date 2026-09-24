import { z } from "zod";
import { MODEL_FAST, MODEL_QUALITY } from "@/lib/groq";
import { callGroqTool } from "@/lib/llm/callTool";
import type { PromptHints } from "@/lib/types";

export interface VaguenessResult {
  vague: boolean;
  clarifyingQuestion?: string;
}

const VaguenessResultSchema = z.object({
  vague: z.boolean(),
  // .nullish() not .optional(): the model reliably emits an explicit `null` for
  // this field when unset rather than omitting the key, which .optional() alone rejects.
  clarifyingQuestion: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
});

const VAGUENESS_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_vagueness_check",
    description:
      "Decide whether an app-idea prompt has enough detail to generate a meaningful PRD, or needs one clarifying question first.",
    parameters: {
      type: "object",
      properties: {
        vague: { type: "boolean" },
        clarifyingQuestion: {
          type: "string",
          description: "Only set when vague=true. One short, specific question that would unlock a real PRD.",
        },
      },
      required: ["vague"],
    },
  },
};

/** Below this many words, a prompt is treated as vague when the model check itself fails. */
const SHORT_PROMPT_WORDS = 8;

/** PRD §6.1: if too vague, ask exactly one clarifying question rather than generating a low-quality PRD from nothing. */
export async function checkVagueness(prompt: string, hints?: PromptHints): Promise<VaguenessResult> {
  try {
    return await callGroqTool({
      model: MODEL_FAST,
      fallbackModel: MODEL_QUALITY,
      maxTokens: 200,
      tool: VAGUENESS_TOOL,
      userContent: `App idea prompt: "${prompt}"\nOptional hints: ${JSON.stringify(hints ?? {})}\n\nIs this specific enough to generate a real PRD (problem statement, target user, core features, user stories, out-of-scope, complexity estimate)? Mark vague only if it's too thin to say anything meaningful about who it's for or what it does — not merely short.`,
      schema: VaguenessResultSchema,
    });
  } catch (err) {
    // Failing open here generated a full, confidently-wrong PRD for "an app" (confirmed live —
    // the model had actually started answering vague:true before its output got cut off). A
    // short prompt is exactly the case this gate exists for, so ask rather than guess; a
    // substantial prompt proceeds, since a failed check says nothing bad about it.
    console.warn("[vagueness] check failed, falling back to a length heuristic:", err);
    const wordCount = prompt.trim().split(/\s+/).length;
    return wordCount < SHORT_PROMPT_WORDS ? { vague: true } : { vague: false };
  }
}
