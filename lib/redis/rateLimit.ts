import { headers } from "next/headers";
import { getRedis } from "@/lib/redis";
import { auth } from "@/lib/auth";

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

/**
 * Every cap-enforcing route calls this instead of assuming "guest" — the pipeline itself still
 * only ever operates on a guest Redis session (Slice 9's Postgres-backed signed-in pipeline
 * hasn't shipped yet), but a signed-in user submitting through that same guest session is still
 * signed in and should get the signedIn limit/message, not be told to "sign up" a second time.
 */
export async function getGenerationTier(): Promise<UserTier> {
  const session = await auth();
  return session?.user?.id ? "signedIn" : "guest";
}

export class RateLimitExceededError extends Error {
  constructor(stage: string, limit: number, tier: UserTier) {
    const upgradeHint = tier === "guest" ? " Sign up for a higher limit." : "";
    super(`Generation cap reached for "${stage}" (limit: ${limit} per 24h).${upgradeHint}`);
    this.name = "RateLimitExceededError";
  }
}

/**
 * The per-session counter alone is keyed by the guest cookie, so dropping the cookie reset every
 * cap (confirmed live). These coarser ceilings sit on top of it, keyed by things a client can't
 * shed as easily: the client IP and, when signed in, the user id. They're deliberately looser
 * (a shared NAT/office IP is many people; a signed-in user may run several sessions) and aren't
 * refunded — they bound abuse, while the per-session counter stays the precise, refundable cap.
 */
const IP_CEILING_MULTIPLIER = 3;
const USER_CEILING_MULTIPLIER = 2;

/** INCR plus a TTL on first use, atomically — a separate EXPIRE could be lost and leave an eternal counter. */
const INCR_WITH_WINDOW_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return count
`;

async function incrementCounter(key: string): Promise<number> {
  return Number(await getRedis().eval(INCR_WITH_WINDOW_SCRIPT, [key], [String(WINDOW_SECONDS)]));
}

/** First hop of x-forwarded-for (set by Vercel's edge), else x-real-ip; null outside a request. */
async function getClientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    return forwarded || h.get("x-real-ip") || null;
  } catch {
    return null;
  }
}

async function getSignedInUserId(): Promise<string | null> {
  try {
    const session = await auth();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function enforceGenerationCap(
  sessionId: string,
  stage: string,
  tier: UserTier = "guest"
): Promise<void> {
  const limit = GENERATION_LIMITS[tier][stage];
  if (!limit) return;

  const sessionKey = `guest:${sessionId}:genCount:${stage}`;
  const sessionCount = await incrementCounter(sessionKey);
  if (sessionCount > limit) {
    throw new RateLimitExceededError(stage, limit, tier);
  }

  const [ip, userId] = await Promise.all([getClientIp(), tier === "signedIn" ? getSignedInUserId() : null]);
  const ceilings: { key: string; limit: number }[] = [];
  if (ip) ceilings.push({ key: `ip:${ip}:genCount:${stage}`, limit: limit * IP_CEILING_MULTIPLIER });
  if (userId) ceilings.push({ key: `user:${userId}:genCount:${stage}`, limit: limit * USER_CEILING_MULTIPLIER });

  for (const ceiling of ceilings) {
    if ((await incrementCounter(ceiling.key)) > ceiling.limit) {
      // Refused, so this request shouldn't count against the session's own cap.
      await getRedis().eval(REFUND_IF_EXISTS_SCRIPT, [sessionKey], []);
      throw new RateLimitExceededError(stage, limit, tier);
    }
  }
}

/**
 * Only decrements a key that's still alive — a plain DECR on an already-expired key would
 * recreate it with no TTL (Redis creates on write), leaving a permanent counter behind that
 * never resets on its normal 24h window. Guarding with EXISTS first, atomically via Lua, means
 * a refund that lands after the original window has already lapsed is just a no-op instead of
 * quietly resurrecting an eternal key.
 */
const REFUND_IF_EXISTS_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  return redis.call("DECR", KEYS[1])
end
return nil
`;

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
  const key = `guest:${sessionId}:genCount:${stage}`;
  await getRedis().eval(REFUND_IF_EXISTS_SCRIPT, [key], []);
}
