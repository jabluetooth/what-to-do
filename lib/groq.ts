import Groq from "groq-sdk";
import { requireEnv } from "@/lib/env";

let client: Groq | undefined;

export function getGroq(): Groq {
  if (!client) {
    client = new Groq({ apiKey: requireEnv("GROQ_API_KEY") });
  }
  return client;
}

/**
 * Quality-sensitive generation: PRD, tech stack, boilerplate fill-in.
 * Verify this model is still current in your Groq console (console.groq.com/docs/models) —
 * Groq's catalog rotates faster than most providers.
 */
export const MODEL_QUALITY = "openai/gpt-oss-120b";

/** Low-latency generation: random idea generator, content moderation gate. */
export const MODEL_FAST = "openai/gpt-oss-20b";

/**
 * Both models are reasoning models: their hidden reasoning tokens count against the completion
 * budget, so a call budgeted for just its answer (e.g. 200 tokens for a one-field verdict) can
 * spend it all thinking and come back truncated or empty — confirmed live as the cause of the
 * vagueness/moderation/idea tool calls failing with tool_use_failed. Low effort keeps reasoning
 * short, and the headroom means callers can keep sizing maxTokens for the answer alone.
 */
const REASONING_HEADROOM_TOKENS = 1024;

export function isReasoningModel(model: string): boolean {
  return model.startsWith("openai/gpt-oss");
}

export function completionBudget(model: string, answerTokens: number) {
  if (!isReasoningModel(model)) return { max_completion_tokens: answerTokens };
  return {
    max_completion_tokens: answerTokens + REASONING_HEADROOM_TOKENS,
    reasoning_effort: "low" as const,
    include_reasoning: false,
  };
}
