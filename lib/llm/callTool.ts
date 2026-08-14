import type { z } from "zod";
import { getGroq } from "@/lib/groq";

interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const MAX_ATTEMPTS = 2;

/**
 * Groq occasionally emits a forced tool call as literal text
 * (`<function=name>{...}`) instead of the structured `tool_calls` field,
 * which the API surfaces as a 400 "tool_use_failed" error even though the
 * model's JSON output is usually still present in the error payload.
 * Retry once, and recover the JSON from the error payload before giving up.
 *
 * The model's output — whether from the structured path or the recovered
 * text — is schema-validated, not just JSON.parsed: a syntactically valid
 * but incomplete/malformed object (e.g. a null field) must fail here and
 * trigger a retry, not silently pass through as good data to the caller.
 */
export async function callGroqTool<T>(params: {
  model: string;
  maxTokens: number;
  tool: ToolDef;
  userContent: string;
  schema: z.ZodType<T>;
}): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const client = getGroq();
      const response = await client.chat.completions.create({
        model: params.model,
        max_tokens: params.maxTokens,
        tools: [params.tool],
        tool_choice: { type: "function", function: { name: params.tool.function.name } },
        messages: [{ role: "user", content: params.userContent }],
      });

      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      if (toolCall) {
        const result = params.schema.safeParse(JSON.parse(toolCall.function.arguments));
        if (result.success) return result.data;
        console.warn(
          `[groq] attempt ${attempt} produced invalid output for ${params.tool.function.name}:`,
          result.error.message
        );
        lastError = new Error(`Invalid output shape from ${params.tool.function.name}`);
        continue;
      }
      lastError = new Error(`Groq returned no tool call for ${params.tool.function.name}`);
    } catch (err) {
      const recovered = recoverFromFailedGeneration(err, params.tool.function.name, params.schema);
      if (recovered) {
        console.warn(
          `[groq] recovered ${params.tool.function.name} from a tool_use_failed error on attempt ${attempt}`
        );
        return recovered;
      }
      console.warn(`[groq] attempt ${attempt} failed for ${params.tool.function.name}:`, err);
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function recoverFromFailedGeneration<T>(err: unknown, toolName: string, schema: z.ZodType<T>): T | null {
  const failedGeneration = (err as { error?: { error?: { failed_generation?: string } } })?.error?.error
    ?.failed_generation;
  if (typeof failedGeneration !== "string") return null;

  const match = failedGeneration.match(new RegExp(`<function=${toolName}>\\s*([\\s\\S]*?)\\s*(?:</function>)?$`));
  if (!match) return null;

  try {
    const result = schema.safeParse(JSON.parse(match[1]));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
