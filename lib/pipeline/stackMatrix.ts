import type { PromptHints, StackCategory } from "@/lib/types";

/**
 * Curated decision matrix, not LLM reasoning — per PRD §10's own recommendation
 * ("curated matrix is safer/more consistent"). The LLM only writes rationale text
 * for picks this matrix already made; it never chooses the stack itself. This also
 * keeps "override one piece" well-defined: swapping a deterministic pick for another
 * known option, not re-rolling a black box.
 *
 * pickStack()'s auto-recommendation only ever picks a backend with a real template behind it
 * (see lib/pipeline/template.ts's resolveTemplateId): "Next.js API routes / Server Actions" or
 * "FastAPI (Python)". NestJS/Django/Rails stay listed below as manual override choices (a user
 * can still pick one from the dropdown) but generating a matching boilerplate for those isn't
 * implemented — overriding to them reintroduces the same stack/boilerplate mismatch this file's
 * auto-pick logic exists to avoid.
 */

export const STACK_ALTERNATIVES: Record<StackCategory, string[]> = {
  frontend: ["Next.js (React, TypeScript)", "SvelteKit", "Vue.js + Nuxt", "React Native (Expo)"],
  backend: [
    "Next.js API routes / Server Actions (same app)",
    "NestJS (Node.js)",
    "FastAPI (Python)",
    "Django (Python)",
    "Ruby on Rails",
  ],
  database: [
    "PostgreSQL (Neon)",
    "SQLite",
    "MongoDB (Atlas)",
    "MySQL (PlanetScale)",
    "PostgreSQL (Supabase)",
    "Firestore (Firebase)",
  ],
  hosting: ["Vercel", "Railway", "Fly.io", "Firebase Hosting"],
  auth: ["Auth.js (NextAuth)", "Clerk", "Auth0", "Supabase Auth", "Firebase Auth"],
};

export interface StackPicks {
  frontend: string;
  backend: string;
  database: string;
  hosting: string;
  auth: string;
  /** True when the picked backend isn't JS/TS — relevant later for live-preview scope (PRD §6.5). */
  nonJsBackend: boolean;
}

function familiarityIncludes(familiarity: string | undefined, ...keywords: string[]): boolean {
  if (!familiarity) return false;
  const lower = familiarity.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

export function pickStack(hints: PromptHints | undefined): StackPicks {
  const familiarity = hints?.stackFamiliarity;
  const platform = hints?.platform;
  const scopeSize = hints?.scopeSize ?? "mvp";

  // Frontend
  let frontend = "Next.js (React, TypeScript)";
  if (platform === "mobile") frontend = "React Native (Expo)";
  else if (familiarityIncludes(familiarity, "vue")) frontend = "Vue.js + Nuxt";
  else if (familiarityIncludes(familiarity, "svelte")) frontend = "SvelteKit";

  // Backend — constrained to the two backends that have an actual boilerplate template
  // (see lib/pipeline/template.ts's resolveTemplateId): recommending NestJS/Django/Rails
  // when generation can only ever produce Next.js or FastAPI code was the original "boilerplate
  // never matches the recommended stack" bug. Django/Rails/NestJS familiarity still steers
  // toward the closest deliverable pick (Python-family -> FastAPI, otherwise Next.js) rather
  // than being ignored outright.
  let backend = "Next.js API routes / Server Actions (same app)";
  let nonJsBackend = false;
  if (familiarityIncludes(familiarity, "django", "rails", "ruby", "fastapi", "flask")) {
    backend = "FastAPI (Python)";
    nonJsBackend = true;
  }

  // Database
  let database = scopeSize === "weekend" ? "SQLite" : "PostgreSQL (Neon)";
  if (familiarityIncludes(familiarity, "mongo")) database = "MongoDB (Atlas)";
  else if (familiarityIncludes(familiarity, "mysql")) database = "MySQL (PlanetScale)";
  else if (familiarityIncludes(familiarity, "supabase")) database = "PostgreSQL (Supabase)";
  else if (familiarityIncludes(familiarity, "firebase", "firestore")) database = "Firestore (Firebase)";
  else if (familiarityIncludes(familiarity, "postgres")) database = "PostgreSQL (Neon)";

  // Hosting
  let hosting = "Vercel";
  if (nonJsBackend) hosting = "Railway";
  else if (familiarityIncludes(familiarity, "firebase")) hosting = "Firebase Hosting";
  else if (familiarityIncludes(familiarity, "fly.io", "flyio")) hosting = "Fly.io";

  // Auth
  let auth = "Auth.js (NextAuth)";
  if (familiarityIncludes(familiarity, "clerk")) auth = "Clerk";
  else if (familiarityIncludes(familiarity, "auth0")) auth = "Auth0";
  else if (familiarityIncludes(familiarity, "supabase")) auth = "Supabase Auth";
  else if (familiarityIncludes(familiarity, "firebase")) auth = "Firebase Auth";

  return { frontend, backend, database, hosting, auth, nonJsBackend };
}
