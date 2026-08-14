import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { requireEnv } from "@/lib/env";
import * as schema from "@/lib/db/schema";

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** HTTP driver (no persistent connections) — matches the zero-ops/serverless hosting decision. */
export function getDb() {
  if (!db) {
    const sql = neon(requireEnv("DATABASE_URL"));
    db = drizzle(sql, { schema });
  }
  return db;
}
