import { getRedis } from "@/lib/redis";

function exhaustionKey(model: string): string {
  return `groq:exhausted:${model}`;
}

/** Fallback cooldown when Groq's own reset hint can't be parsed from the error. */
const DEFAULT_COOLDOWN_SECONDS = 300;

/**
 * Tracks (in Redis, shared across the app) that a Groq model is currently rate-limited,
 * so callers can fail fast instead of attempting a call known to be doomed — used for
 * boilerplate generation, where the weaker fallback model has proven unreliable enough at
 * code generation that attempting anyway just wastes a full install+build cycle (see
 * lib/llm/generateCode.ts's reliability notes).
 */
export async function markModelExhausted(model: string, retryAfterSeconds?: number): Promise<void> {
  const ttl = retryAfterSeconds && retryAfterSeconds > 0 ? Math.ceil(retryAfterSeconds) : DEFAULT_COOLDOWN_SECONDS;
  await getRedis().set(exhaustionKey(model), Date.now(), { ex: ttl });
}

export async function isModelExhausted(model: string): Promise<boolean> {
  const value = await getRedis().get(exhaustionKey(model));
  return value !== null;
}

/** Reads Groq's x-ratelimit-reset-{tokens,requests} headers (format e.g. "17.89s", "6m42.624s"). */
export function parseGroqRetryAfterSeconds(headers: unknown): number | undefined {
  const get = (headers as { get?: (name: string) => string | null } | undefined)?.get;
  if (typeof get !== "function") return undefined;
  const resetTokens = get.call(headers, "x-ratelimit-reset-tokens");
  const resetRequests = get.call(headers, "x-ratelimit-reset-requests");
  return parseDuration(resetTokens) ?? parseDuration(resetRequests);
}

function parseDuration(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const match = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
  if (!match || (!match[1] && !match[2] && !match[3])) return undefined;
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const seconds = match[3] ? parseFloat(match[3]) : 0;
  return hours * 3600 + minutes * 60 + seconds;
}
