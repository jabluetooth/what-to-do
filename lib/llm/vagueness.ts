import { z } from "zod";
import { MODEL_FAST } from "@/lib/groq";
import { callGroqTool } from "@/lib/llm/callTool";
import type { PromptHints } from "@/lib/types";

export interface VaguenessResult {
  vague: boolean;
  clarifyingQuestion?: string;
}

const VaguenessResultSchema = z.object({
  vague: z.boolean(),
  clarifyingQuestion: z.string().optional(),
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

/** PRD §6.1: if too vague, ask exactly one clarifying question rather than generating a low-quality PRD from nothing. */
export async function checkVagueness(prompt: string, hints?: PromptHints): Promise<VaguenessResult> {
  try {
    return await callGroqTool({
      model: MODEL_FAST,
      maxTokens: 200,
      tool: VAGUENESS_TOOL,
      userContent: `App idea prompt: "${prompt}"\nOptional hints: ${JSON.stringify(hints ?? {})}\n\nIs this specific enough to generate a real PRD (problem statement, target user, core features, user stories, out-of-scope, complexity estimate)? Mark vague only if it's too thin to say anything meaningful about who it's for or what it does — not merely short.`,
      schema: VaguenessResultSchema,
    });
  } catch {
    return { vague: false };
  }
}
