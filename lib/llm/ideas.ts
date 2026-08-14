import { z } from "zod";
import { MODEL_FAST } from "@/lib/groq";
import { callGroqTool } from "@/lib/llm/callTool";
import type { RandomIdea } from "@/lib/types";

const RandomIdeaSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  platformTag: z.enum(["web", "mobile"]),
});

const IDEA_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_idea",
    description: "Emit one random, buildable app idea for a developer with no starting idea.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short, catchy app name or concept (a few words)." },
        description: { type: "string", description: "One sentence: what it does and who it's for." },
        platformTag: { type: "string", enum: ["web", "mobile"] },
      },
      required: ["title", "description", "platformTag"],
    },
  },
};

/**
 * PRD §6.1.1: avoid repeating the same idea twice in a row, and avoid near-duplicate
 * ideas across a short regeneration streak (e.g. three recipe-app variants back to back).
 */
export async function generateRandomIdea(avoidTitles: string[]): Promise<RandomIdea> {
  const avoidLine = avoidTitles.length
    ? `Avoid repeating or lightly rephrasing any of these recently shown ideas, and avoid close variants of the same concept (e.g. don't return three recipe-app spins in a row): ${avoidTitles.join("; ")}.`
    : "";

  return callGroqTool({
    model: MODEL_FAST,
    // 200 was too tight: verbose descriptions occasionally got truncated mid-JSON before the
    // closing brace, which is exactly what forces Groq into the tool_use_failed text fallback.
    maxTokens: 400,
    tool: IDEA_TOOL,
    userContent: `Suggest one random, concrete app idea for a developer (indie hacker / hackathon participant / student) who has no idea what to build. Scope it small enough for a weekend-to-MVP timeframe. Vary the domain — don't default to productivity/todo apps. ${avoidLine}`,
    schema: RandomIdeaSchema,
  });
}
