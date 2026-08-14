import { Redis } from "@upstash/redis";
import { requireEnv } from "@/lib/env";

let client: Redis | undefined;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis({
      url: requireEnv("UPSTASH_REDIS_REST_URL"),
      token: requireEnv("UPSTASH_REDIS_REST_TOKEN"),
    });
  }
  return client;
}
