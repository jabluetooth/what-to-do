import { z } from "zod";
import { MODEL_QUALITY } from "@/lib/groq";
import { callGroqTool } from "@/lib/llm/callTool";
import type { PrdSection } from "@/lib/types";

const RESOURCE_NAME_REGEX = /^[a-z][a-z0-9_]*$/;

const ResourceNameSchema = z.object({
  mainResourceName: z.string().min(1).regex(RESOURCE_NAME_REGEX, "must be lowercase, plural, snake/URL-safe"),
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
    maxTokens: 100,
    tool: RESOURCE_NAME_TOOL,
    userContent: `${baseContext(input.prompt, input.sections)}\n\nPick the one core data entity this app most revolves around (not every feature — just this slice) and name it.`,
    schema: ResourceNameSchema,
  });
  return mainResourceName;
}
