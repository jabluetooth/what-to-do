import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Lazy: routes that don't touch the database (or aren't hit yet, e.g. an idle live preview)
// shouldn't crash on import just because DATABASE_URL isn't set.
let instance: ReturnType<typeof drizzle> | undefined;

function getDb() {
  if (!instance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("Missing DATABASE_URL environment variable");
    }
    instance = drizzle(postgres(connectionString));
  }
  return instance;
}

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
