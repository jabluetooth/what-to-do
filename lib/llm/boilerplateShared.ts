import { z } from "zod";
import { MODEL_FAST, MODEL_QUALITY } from "@/lib/groq";
import { callGroqTool } from "@/lib/llm/callTool";
import type { PrdSection } from "@/lib/types";

const RESOURCE_NAME_REGEX = /^[a-z][a-z0-9_]*$/;

/**
 * Models reliably pick a sensible name but often format it as "grocery-items" or "GroceryItems";
 * rejecting that failed whole boilerplate jobs on a cosmetic detail (confirmed live, identically
 * on all three attempts). Normalize to snake_case first, then validate what's left.
 */
function toSnakeIdentifier(raw: string): string {
  return raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const ResourceNameSchema = z.object({
  mainResourceName: z
    .string()
    .transform(toSnakeIdentifier)
    .pipe(z.string().regex(RESOURCE_NAME_REGEX, "must be lowercase, plural, snake/URL-safe")),
});

const RESOURCE_NAME_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_resource_name",
    description: "Pick this app's single central data resource and name it.",
    parameters: {
      type: "object",
      properties: {
        mainResourceName: {
          type: "string",
          description: "Lowercase, plural, URL-safe identifier for the main resource (e.g. 'invoices', 'trails').",
        },
      },
      required: ["mainResourceName"],
    },
  },
};

export function findSection(sections: PrdSection[], key: string): string {
  return sections.find((s) => s.key === key)?.content ?? "";
}

export function baseContext(prompt: string, sections: PrdSection[]): string {
  return [
    `App idea prompt: "${prompt}"`,
    `Problem statement: ${findSection(sections, "problem_statement")}`,
    `Target user: ${findSection(sections, "target_user")}`,
    `Core features: ${findSection(sections, "core_features")}`,
  ].join("\n");
}

/**
 * Short, simple, escape-free field — tool-calling is fine here, unlike the code content
 * generated downstream. Shared across every boilerplate template (Next.js, FastAPI, ...): which
 * resource this app revolves around doesn't depend on which stack is generating it.
 */
export async function pickResourceName(input: { prompt: string; sections: PrdSection[] }): Promise<string> {
  const { mainResourceName } = await callGroqTool({
    model: MODEL_QUALITY,
    fallbackModel: MODEL_FAST,
    maxTokens: 100,
    tool: RESOURCE_NAME_TOOL,
    userContent: `${baseContext(input.prompt, input.sections)}\n\nPick the one core data entity this app most revolves around (not every feature — just this slice) and name it.`,
    schema: ResourceNameSchema,
  });
  return mainResourceName;
}
