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
