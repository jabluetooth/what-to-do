import { getRedis } from "@/lib/redis";

const WINDOW_SECONDS = 24 * 60 * 60;

export type UserTier = "guest" | "signedIn";

/**
 * v1 concrete caps (PRD §10's "pricing model TBD" is now resolved to these initial
 * numbers, tunable later). Boilerplate is capped tightest for guests specifically: it's
 * the most expensive stage (LLM code-gen + a real npm install + build check) and, per
 * live testing, the one most likely to fail outright when only the weak fallback model
 * is available — see the fail-fast check in /api/boilerplate/generate.
 *
 * `signedIn` limits are wired up here even though no signed-in system exists yet (Slice
 * 7): every call site today only ever has a guest session and passes no tier, defaulting
 * to "guest" — Slice 7 only needs to pass tier="signedIn" for authenticated requests, no
 * redesign of this module.
 */
const GENERATION_LIMITS: Record<UserTier, Record<string, number>> = {
  guest: {
    prd: 5,
    ideas: 5,
    stack: 10,
    boilerplate: 2,
  },
  signedIn: {
    prd: 10,
    ideas: 10,
    stack: 10,
    boilerplate: 5,
  },
};

export class RateLimitExceededError extends Error {
  constructor(stage: string, limit: number, tier: UserTier) {
    const upgradeHint = tier === "guest" ? " Sign up for a higher limit." : "";
    super(`Generation cap reached for "${stage}" (limit: ${limit} per 24h).${upgradeHint}`);
    this.name = "RateLimitExceededError";
  }
}

export async function enforceGenerationCap(
  sessionId: string,
  stage: string,
  tier: UserTier = "guest"
): Promise<void> {
  const limit = GENERATION_LIMITS[tier][stage];
  if (!limit) return;

  const key = `guest:${sessionId}:genCount:${stage}`;
  const count = await getRedis().incr(key);
  if (count === 1) {
    await getRedis().expire(key, WINDOW_SECONDS);
  }
  if (count > limit) {
    throw new RateLimitExceededError(stage, limit, tier);
  }
}

/**
 * Gives back a cap unit consumed by a submission that never got a real shot — a platform-side
 * failure (e.g. the sandbox validator's disk quota), not a bad generation. Deliberately not
 * called for ordinary generation failures (bad LLM output, a failed build check on legit
 * grounds): those already spent real LLM/compute cost, which is what the cap protects against.
 * DECR going below zero is harmless — Redis allows negative counters, and it just means the
 * next real submission needs to climb back past zero before the limit bites again.
 */
export async function refundGenerationCap(
  sessionId: string,
  stage: string,
  tier: UserTier = "guest"
): Promise<void> {
  if (!GENERATION_LIMITS[tier][stage]) return;
  await getRedis().decr(`guest:${sessionId}:genCount:${stage}`);
}
