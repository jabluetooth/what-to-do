import { getRedis } from "@/lib/redis";

const WINDOW_SECONDS = 24 * 60 * 60;

/**
 * Conservative v1 defaults. Real numbers are TBD pending the pricing model
 * (PRD §10, open question) — the mechanism ships now, the numbers get tuned later.
 */
const GUEST_STAGE_LIMITS: Record<string, number> = {
  prd: 10,
  stack: 10,
  boilerplate: 5,
};

export class RateLimitExceededError extends Error {
  constructor(stage: string, limit: number) {
    super(`Generation cap reached for "${stage}" (limit: ${limit} per 24h). Sign up for a higher limit.`);
    this.name = "RateLimitExceededError";
  }
}

export async function enforceGuestGenerationCap(sessionId: string, stage: string): Promise<void> {
  const limit = GUEST_STAGE_LIMITS[stage];
  if (!limit) return;

  const key = `guest:${sessionId}:genCount:${stage}`;
  const count = await getRedis().incr(key);
  if (count === 1) {
    await getRedis().expire(key, WINDOW_SECONDS);
  }
  if (count > limit) {
    throw new RateLimitExceededError(stage, limit);
  }
}
