import { z } from "zod";
import { MODEL_QUALITY } from "@/lib/groq";
import { callGroqTool } from "@/lib/llm/callTool";
import type { PrdSection, PromptHints } from "@/lib/types";

/** Fixed, ordered section set per PRD §6.2 — the order here is what downstream storage/UI/section-regenerate all key off. */
export const PRD_SECTION_DEFS: { key: string; title: string }[] = [
  { key: "problem_statement", title: "Problem Statement" },
  { key: "target_user", title: "Target User" },
  { key: "core_features", title: "Core Features (MVP-scoped)" },
  { key: "user_stories", title: "User Stories" },
  { key: "out_of_scope", title: "Out of Scope" },
  { key: "complexity_estimate", title: "Rough Complexity / Time Estimate" },
];

const PRD_SECTION_KEYS = PRD_SECTION_DEFS.map((s) => s.key);

const PrdToolOutputSchema = z.object({
  sections: z.array(z.object({ key: z.string(), content: z.string() })),
});

const PRD_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_prd",
    description: "Emit a structured PRD for the given app idea, one entry per required section.",
    parameters: {
      type: "object",
      properties: {
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string", enum: PRD_SECTION_KEYS },
              content: { type: "string" },
            },
            required: ["key", "content"],
          },
          minItems: PRD_SECTION_DEFS.length,
          maxItems: PRD_SECTION_DEFS.length,
        },
      },
      required: ["sections"],
    },
  },
};

export interface GeneratePrdInput {
  prompt: string;
  hints?: PromptHints;
  clarification?: { question: string; answer: string };
  lowConfidence?: boolean;
}

export interface GeneratePrdResult {
  sections: PrdSection[];
  lowConfidence: boolean;
}

export async function generatePrd(input: GeneratePrdInput): Promise<GeneratePrdResult> {
  const contextLines = [`App idea prompt: "${input.prompt}"`];
  if (input.hints?.platform) contextLines.push(`Platform: ${input.hints.platform}`);
  if (input.hints?.scopeSize) contextLines.push(`Rough scope: ${input.hints.scopeSize}`);
  if (input.hints?.stackFamiliarity) {
    contextLines.push(`Developer's familiar stack (context only, not binding here): ${input.hints.stackFamiliarity}`);
  }
  if (input.clarification) {
    contextLines.push(`Clarifying question asked: ${input.clarification.question}`);
    contextLines.push(`Developer's answer: ${input.clarification.answer}`);
  }

  const raw = await callGroqTool({
    model: MODEL_QUALITY,
    maxTokens: 2000,
    tool: PRD_TOOL,
    userContent: `Generate a concise, MVP-scoped PRD for a developer app idea. Write for a solo developer deciding what to build next, not a corporate audience. Keep each section to a few sentences or a short bullet list — this feeds a scaffolding pipeline, not a formal document.\n\n${contextLines.join("\n")}\n\nEmit exactly these sections, in this order: ${PRD_SECTION_DEFS.map((s) => `${s.key} (${s.title})`).join(", ")}.`,
    schema: PrdToolOutputSchema,
  });

  const sections: PrdSection[] = PRD_SECTION_DEFS.map((def) => {
    const match = raw.sections.find((s) => s.key === def.key);
    return { key: def.key, title: def.title, content: match?.content ?? "" };
  });

  return { sections, lowConfidence: input.lowConfidence ?? false };
}
