import type { z } from "zod";
import { getGroq } from "@/lib/groq";
import { markModelExhausted, parseGroqRetryAfterSeconds, isRateLimitError } from "@/lib/llm/modelAvailability";

interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const MAX_ATTEMPTS = 3;

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
 *
 * `fallbackModel`, if given, is tried when the primary model hits a 429 —
 * Groq's token-per-day limits are tracked per model, not pooled across the
 * account (confirmed live: the 429 body names the specific model and its own
 * limit/used counts), so a same-account, same-key model switch is a real
 * fallback, not just a retry of the same wall.
 */
export async function callGroqTool<T>(params: {
  model: string;
  fallbackModel?: string;
  maxTokens: number;
  tool: ToolDef;
  userContent: string;
  schema: z.ZodType<T>;
}): Promise<T> {
  let lastError: unknown;
  let currentModel = params.model;
  let switchedToFallback = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const client = getGroq();
      const response = await client.chat.completions.create({
        model: currentModel,
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
          `[groq] attempt ${attempt} (${currentModel}) produced invalid output for ${params.tool.function.name}:`,
          result.error.message
        );
        lastError = new Error(`Invalid output shape from ${params.tool.function.name}`);
        continue;
      }
      lastError = new Error(`Groq returned no tool call for ${params.tool.function.name}`);
    } catch (err) {
      if (isRateLimitError(err)) {
        void markModelExhausted(
          currentModel,
          parseGroqRetryAfterSeconds((err as { headers?: unknown })?.headers)
        );

        if (params.fallbackModel && !switchedToFallback) {
          console.warn(
            `[groq] ${params.tool.function.name}: ${currentModel} is rate-limited, switching to fallback model ${params.fallbackModel}`
          );
          currentModel = params.fallbackModel;
          switchedToFallback = true;
          lastError = err;
          continue;
        }
      }

      const recovered = recoverFromFailedGeneration(err, params.tool.function.name, params.schema);
      if (recovered) {
        console.warn(
          `[groq] recovered ${params.tool.function.name} from a tool_use_failed error on attempt ${attempt} (${currentModel})`
        );
        return recovered;
      }
      console.warn(`[groq] attempt ${attempt} failed for ${params.tool.function.name} (${currentModel}):`, err);
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function recoverFromFailedGeneration<T>(err: unknown, toolName: string, schema: z.ZodType<T>): T | null {
  const failedGeneration = (err as { error?: { error?: { failed_generation?: string } } })?.error?.error
    ?.failed_generation;
  if (typeof failedGeneration !== "string") {
    console.warn(`[groq recovery] ${toolName}: no failed_generation string on error`);
    return null;
  }

  const tagIndex = failedGeneration.indexOf(`<function=${toolName}>`);
  if (tagIndex === -1) {
    console.warn(`[groq recovery] ${toolName}: opening tag not found in failed_generation:`, failedGeneration);
    return null;
  }

  const jsonText = extractJsonObject(failedGeneration, tagIndex);
  if (!jsonText) {
    console.warn(`[groq recovery] ${toolName}: no balanced {...} found after tag:`, failedGeneration);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(sanitizeJsonLikeText(jsonText));
  } catch (parseErr) {
    console.warn(`[groq recovery] ${toolName}: JSON.parse failed on extracted text:`, jsonText, parseErr);
    return null;
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    console.warn(`[groq recovery] ${toolName}: schema validation failed on extracted JSON:`, jsonText, result.error.message);
    return null;
  }

  return result.data;
}

/**
 * Three concrete, reproducible malformations observed from Groq's text-fallback path,
 * fixed up before JSON.parse rather than treated as unrecoverable:
 *   1. Literal control characters (raw newlines/tabs) embedded inside string values
 *      instead of escaped — happens when the model generates a bulleted list inside
 *      a string field. JSON requires `\n`, not a literal newline byte.
 *   2. Python-style `True`/`False`/`None` used instead of JSON's `true`/`false`/`null`.
 *   3. Backtick template-literal syntax used as the string delimiter instead of double
 *      quotes (`"code": \`...\`` instead of `"code": "..."`) — a habit bleeding in from
 *      generating JS/TS code. Both delimiters are normalized to `"` on output; a literal
 *      `"` found inside a backtick-delimited value is escaped so it doesn't prematurely
 *      close the rewritten string.
 * All fixes are string-state-aware so they never touch legitimate string content (e.g.
 * the English word "False" in prose, or a real template literal nested inside a
 * properly double-quoted value, are both left untouched).
 */
function sanitizeJsonLikeText(text: string): string {
  let out = "";
  let stringDelim: '"' | "`" | null = null;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (stringDelim) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === "\\") {
        out += ch;
        escaped = true;
      } else if (ch === stringDelim) {
        out += '"'; // normalize whichever delimiter opened this string to a JSON double-quote
        stringDelim = null;
      } else if (ch === '"' && stringDelim === "`") {
        out += '\\"'; // a literal " inside a backtick string must be escaped once we rewrite the delimiter
      } else if (ch === "\n") {
        out += "\\n";
      } else if (ch === "\r") {
        out += "\\r";
      } else if (ch === "\t") {
        out += "\\t";
      } else {
        out += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "`") {
      stringDelim = ch;
      out += '"';
      continue;
    }

    const literal = matchPythonLiteral(text, i);
    if (literal) {
      out += literal.replacement;
      i += literal.length - 1;
      continue;
    }

    out += ch;
  }

  return out;
}

function matchPythonLiteral(text: string, i: number): { replacement: string; length: number } | null {
  const candidates: [string, string][] = [
    ["True", "true"],
    ["False", "false"],
    ["None", "null"],
  ];
  const prevChar = text[i - 1];
  if (prevChar && /[A-Za-z0-9_]/.test(prevChar)) return null;

  for (const [word, replacement] of candidates) {
    if (text.startsWith(word, i)) {
      const nextChar = text[i + word.length];
      if (nextChar && /[A-Za-z0-9_]/.test(nextChar)) continue;
      return { replacement, length: word.length };
    }
  }
  return null;
}

/**
 * Finds the first `{...}` JSON object after `fromIndex` by tracking brace depth
 * (string/escape-aware, so braces inside string values don't miscount). A regex
 * anchored to end-of-string is too brittle here: the model sometimes appends
 * stray trailing characters after the JSON (e.g. a trailing "." before
 * "</function>"), which breaks JSON.parse even though the object itself is
 * valid — this stops exactly at the matching closing brace and ignores
 * anything after it.
 *
 * Tracks both `"` and backtick as string delimiters (independently — only the
 * character that opened a string closes it): a value delimited by backticks
 * instead of quotes is a real observed pattern (see sanitizeJsonLikeText), and
 * without this, braces inside that backtick-delimited code (function bodies,
 * object literals) would miscount the depth before sanitization ever runs.
 */
function extractJsonObject(text: string, fromIndex: number): string | null {
  const start = text.indexOf("{", fromIndex);
  if (start === -1) return null;

  let depth = 0;
  let stringDelim: '"' | "`" | null = null;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (stringDelim) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === stringDelim) stringDelim = null;
      continue;
    }

    if (ch === '"' || ch === "`") stringDelim = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}
