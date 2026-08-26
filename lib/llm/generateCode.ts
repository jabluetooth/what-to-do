import { getGroq } from "@/lib/groq";
import { markModelExhausted, parseGroqRetryAfterSeconds, isRateLimitError } from "@/lib/llm/modelAvailability";

const MAX_ATTEMPTS = 2;
const FENCE_RE = /```(?:[a-zA-Z]*)\n?([\s\S]*?)```/;

/**
 * For a single code file's content, this deliberately avoids tool-calling / JSON-embedding
 * entirely. Live testing (see lib/llm/callTool.ts's sanitizer) showed models reliably fail
 * to correctly JSON-escape large multi-line code as a string value — missing quotes, using
 * backticks as the string delimiter, inconsistent over/under-escaping — across both model
 * sizes on Groq. Asking for a single fenced code block as plain text and extracting it with
 * a regex sidesteps the problem entirely: there's no JSON layer for the code to be malformed
 * within. Reserve tool-calling for short, simple fields (identifiers, enums) where it's fine.
 */
export async function generateCodeFile(params: {
  model: string;
  fallbackModel?: string;
  maxTokens: number;
  instructions: string;
}): Promise<string> {
  const client = getGroq();
  let currentModel = params.model;
  let currentMaxTokens = params.maxTokens;
  let switchedToFallback = false;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: currentModel,
        max_tokens: currentMaxTokens,
        messages: [
          {
            role: "user",
            content: `${params.instructions}\n\nRespond with ONLY a single markdown code fence containing the complete file content — no explanation before or after, no multiple files.`,
          },
        ],
      });

      const choice = response.choices[0];
      const text = choice?.message?.content ?? "";
      const match = text.match(FENCE_RE);

      // finish_reason "length" (or a fence opened but never closed, as a fallback signal) means
      // the file was cut off mid-generation -- confirmed live as the cause of a schema.ts with
      // an unterminated `sql\`...\`` default, since the old code below fell back to returning
      // this exact truncated, syntactically-broken text as if generation had succeeded.
      if (choice?.finish_reason === "length" || (!match && /```/.test(text))) {
        console.warn(
          `[groq] generateCodeFile attempt ${attempt} (${currentModel}) response truncated (finish_reason=${choice?.finish_reason}), retrying with a larger token budget`
        );
        currentMaxTokens *= 2;
        lastError = new Error("Model response was truncated before the file was complete");
        continue;
      }

      const code = (match ? match[1] : text).trim();
      if (code) return code;

      console.warn(`[groq] generateCodeFile attempt ${attempt} (${currentModel}) returned no content`);
      lastError = new Error("No code content returned");
    } catch (err) {
      if (isRateLimitError(err)) {
        void markModelExhausted(
          currentModel,
          parseGroqRetryAfterSeconds((err as { headers?: unknown })?.headers)
        );

        if (params.fallbackModel && !switchedToFallback) {
          console.warn(
            `[groq] generateCodeFile: ${currentModel} is rate-limited, switching to fallback model ${params.fallbackModel}`
          );
          currentModel = params.fallbackModel;
          switchedToFallback = true;
          continue;
        }
      }
      console.warn(`[groq] generateCodeFile attempt ${attempt} (${currentModel}) failed:`, err);
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
