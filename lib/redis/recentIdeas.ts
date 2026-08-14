import { getRedis } from "@/lib/redis";
import { GUEST_SESSION_TTL_SECONDS } from "@/lib/redis/guestSession";

/** Small recency window — just enough to stop back-to-back repeats/near-duplicates (PRD §6.1.1). */
const RECENT_IDEAS_LIMIT = 5;

function key(sessionId: string): string {
  return `guest:${sessionId}:recentIdeas`;
}

export async function getRecentIdeaTitles(sessionId: string): Promise<string[]> {
  const redis = getRedis();
  const titles = await redis.lrange<string>(key(sessionId), 0, RECENT_IDEAS_LIMIT - 1);
  return titles ?? [];
}

export async function pushRecentIdeaTitle(sessionId: string, title: string): Promise<void> {
  const redis = getRedis();
  const k = key(sessionId);
  await redis.lpush(k, title);
  await redis.ltrim(k, 0, RECENT_IDEAS_LIMIT - 1);
  await redis.expire(k, GUEST_SESSION_TTL_SECONDS);
}
