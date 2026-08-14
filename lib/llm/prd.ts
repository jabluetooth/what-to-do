import { z } from "zod";
import { MODEL_QUALITY, MODEL_FAST } from "@/lib/groq";
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

/**
 * Flat schema (one string field per section) rather than a nested `sections: [{key,content}]`
 * array-of-objects: live testing showed Groq's forced tool-calling reliably breaks on that nested
 * shape for a 6-section PRD (mismatched braces, trailing garbage, occasional outright-malformed
 * JSON with a spurious extra `}` mid-array) while flat schemas elsewhere (moderation, vagueness,
 * ideas) have been solid throughout. This isn't a parsing bug to work around — it's a shape the
 * model can emit reliably in the first place.
 */
const PrdToolOutputSchema = z.object({
  problem_statement: z.string().min(1),
  target_user: z.string().min(1),
  core_features: z.string().min(1),
  user_stories: z.string().min(1),
  out_of_scope: z.string().min(1),
  complexity_estimate: z.string().min(1),
});

const PRD_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_prd",
    description: "Emit a structured PRD for the given app idea, one field per required section.",
    parameters: {
      type: "object",
      properties: {
        problem_statement: { type: "string", description: "Content for the Problem Statement section." },
        target_user: { type: "string", description: "Content for the Target User section." },
        core_features: { type: "string", description: "Content for the Core Features (MVP-scoped) section." },
        user_stories: { type: "string", description: "Content for the User Stories section." },
        out_of_scope: { type: "string", description: "Content for the Out of Scope section." },
        complexity_estimate: {
          type: "string",
          description: "Content for the Rough Complexity / Time Estimate section.",
        },
      },
      required: PRD_SECTION_DEFS.map((s) => s.key),
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
    fallbackModel: MODEL_FAST,
    maxTokens: 2000,
    tool: PRD_TOOL,
    userContent: `Generate a concise, MVP-scoped PRD for a developer app idea. Write for a solo developer deciding what to build next, not a corporate audience. Keep each section to a few sentences or a short bullet list — this feeds a scaffolding pipeline, not a formal document.\n\n${contextLines.join("\n")}\n\nEmit exactly these sections, in this order: ${PRD_SECTION_DEFS.map((s) => `${s.key} (${s.title})`).join(", ")}.`,
    schema: PrdToolOutputSchema,
  });

  const sections: PrdSection[] = PRD_SECTION_DEFS.map((def) => ({
    key: def.key,
    title: def.title,
    content: raw[def.key as keyof typeof raw],
  }));

  return { sections, lowConfidence: input.lowConfidence ?? false };
}

const PRD_SECTION_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_prd_section",
    description: "Emit a replacement for one PRD section, consistent with the rest of the document.",
    parameters: {
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"],
    },
  },
};

const PrdSectionOutputSchema = z.object({ content: z.string().min(1) });

/**
 * Section-level regenerate is the default way to fix a disliked part of the PRD (not a
 * full-document restart): the rest of the PRD is passed as fixed context so only the
 * target section changes, keeping everything else the user already approved intact.
 */
export async function regeneratePrdSection(input: {
  prompt: string;
  hints?: PromptHints;
  existingSections: PrdSection[];
  targetKey: string;
  instructions?: string;
}): Promise<PrdSection> {
  const def = PRD_SECTION_DEFS.find((s) => s.key === input.targetKey);
  if (!def) {
    throw new Error(`Unknown PRD section key: ${input.targetKey}`);
  }

  const otherSections = input.existingSections
    .filter((s) => s.key !== input.targetKey)
    .map((s) => `${s.title}:\n${s.content}`)
    .join("\n\n");

  const { content } = await callGroqTool({
    model: MODEL_QUALITY,
    fallbackModel: MODEL_FAST,
    maxTokens: 800,
    tool: PRD_SECTION_TOOL,
    userContent: `App idea prompt: "${input.prompt}"\n\nRest of the current PRD (context for consistency — do not repeat it back):\n\n${otherSections}\n\nRewrite only the "${def.title}" section.${input.instructions ? ` Developer's guidance: ${input.instructions}` : ""}`,
    schema: PrdSectionOutputSchema,
  });

  return { key: def.key, title: def.title, content };
}
