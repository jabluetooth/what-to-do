import { Client } from "@upstash/qstash";
import { requireEnv } from "@/lib/env";

let client: Client | undefined;

export function getQStash(): Client {
  if (!client) {
    client = new Client({ token: requireEnv("QSTASH_TOKEN") });
  }
  return client;
}
