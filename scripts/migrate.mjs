// Applies pending Drizzle migrations (./drizzle/*.sql, generated via `pnpm db:generate`)
// to the real Neon database. Run via `pnpm db:migrate`, which loads .env.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (run this via \`pnpm db:migrate\`, which loads .env)`);
  }
  return value;
}

const sql = neon(requireEnv("DATABASE_URL"));
const db = drizzle(sql);

await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
