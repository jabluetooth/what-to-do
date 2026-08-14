import { z } from "zod";
import { MODEL_QUALITY } from "@/lib/groq";
import { callGroqTool } from "@/lib/llm/callTool";
import type { PrdSection } from "@/lib/types";
import type { StackPicks } from "@/lib/pipeline/stackMatrix";

/** Flat schema — one string field per category, matching the pattern that's proven reliable for Groq's forced tool-calling (see lib/llm/prd.ts for why nested shapes are avoided). */
const StackRationaleSchema = z.object({
  frontend: z.string().min(1),
  backend: z.string().min(1),
  database: z.string().min(1),
  hosting: z.string().min(1),
  auth: z.string().min(1),
});

export type StackRationale = z.infer<typeof StackRationaleSchema>;

const STACK_RATIONALE_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_stack_rationale",
    description: "Emit a one-to-two sentence rationale for each already-chosen stack piece, specific to this app idea.",
    parameters: {
      type: "object",
      properties: {
        frontend: { type: "string", description: "Why the frontend choice fits this specific app." },
        backend: { type: "string", description: "Why the backend choice fits this specific app." },
        database: { type: "string", description: "Why the database choice fits this specific app." },
        hosting: { type: "string", description: "Why the hosting choice fits this specific app." },
        auth: { type: "string", description: "Why the auth choice fits this specific app." },
      },
      required: ["frontend", "backend", "database", "hosting", "auth"],
    },
  },
};

function findSection(sections: PrdSection[], key: string): string {
  return sections.find((s) => s.key === key)?.content ?? "";
}

/**
 * The picks themselves come from the curated matrix (lib/pipeline/stackMatrix.ts), not the LLM —
 * this only writes the "why" for picks that are already decided, using the PRD as grounding so
 * the rationale is specific to the app rather than generic tech-choice boilerplate.
 */
export async function generateStackRationale(input: {
  prompt: string;
  sections: PrdSection[];
  picks: StackPicks;
}): Promise<StackRationale> {
  const context = [
    `App idea prompt: "${input.prompt}"`,
    `Problem statement: ${findSection(input.sections, "problem_statement")}`,
    `Target user: ${findSection(input.sections, "target_user")}`,
    `Core features: ${findSection(input.sections, "core_features")}`,
    "",
    "Already-chosen stack (do not change these picks, only explain them):",
    `Frontend: ${input.picks.frontend}`,
    `Backend: ${input.picks.backend}`,
    `Database: ${input.picks.database}`,
    `Hosting: ${input.picks.hosting}`,
    `Auth: ${input.picks.auth}`,
  ].join("\n");

  return callGroqTool({
    model: MODEL_QUALITY,
    maxTokens: 600,
    tool: STACK_RATIONALE_TOOL,
    userContent: `${context}\n\nWrite a short, specific rationale (1-2 sentences) for each piece — reference something concrete about this app idea, not generic praise for the technology.`,
    schema: StackRationaleSchema,
  });
}
