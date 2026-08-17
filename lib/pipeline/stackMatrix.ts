import type { PromptHints, StackCategory } from "@/lib/types";
import { TEMPLATE_REGISTRY, DEFAULT_TEMPLATE, type TemplateDescriptor } from "@/lib/pipeline/templateRegistry";

/**
 * Curated decision matrix, not LLM reasoning — per PRD §10's own recommendation
 * ("curated matrix is safer/more consistent"). The LLM only writes rationale text
 * for picks this matrix already made; it never chooses the stack itself. This also
 * keeps "override one piece" well-defined: swapping a deterministic pick for another
 * known option, not re-rolling a black box.
 *
 * pickStack()'s auto-recommendation only ever picks a backend with a real template behind it —
 * one of templateRegistry.ts's TEMPLATE_REGISTRY entries. NestJS/Django/Rails stay listed below
 * as manual override choices (a user can still pick one from the dropdown) but generating a
 * matching boilerplate for those isn't implemented — overriding to them reintroduces the same
 * stack/boilerplate mismatch this file's auto-pick logic exists to avoid.
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

/** First non-default template whose keywords match the free-text familiarity hint, if any. */
function matchTemplate(familiarity: string | undefined): TemplateDescriptor | undefined {
  return TEMPLATE_REGISTRY.find(
    (template) => template !== DEFAULT_TEMPLATE && familiarityIncludes(familiarity, ...template.keywords)
  );
}

export function pickStack(hints: PromptHints | undefined): StackPicks {
  const familiarity = hints?.stackFamiliarity;
  const platform = hints?.platform;
  const matched = matchTemplate(familiarity);
  const nonJsBackend = matched ? !matched.webContainerCompatible : false;

  // Frontend
  let frontend = "Next.js (React, TypeScript)";
  if (platform === "mobile") frontend = "React Native (Expo)";
  else if (familiarityIncludes(familiarity, "vue")) frontend = "Vue.js + Nuxt";
  else if (familiarityIncludes(familiarity, "svelte")) frontend = "SvelteKit";
  if (matched?.frontendOverride) frontend = matched.frontendOverride;

  const backend = (matched ?? DEFAULT_TEMPLATE).backendChoice;

  // Database — only Postgres is ever actually generated (Drizzle for the Next.js template,
  // SQLAlchemy for the FastAPI one), so unlike backend/frontend this isn't template-driven —
  // every current template needs the same database regardless of which one gets picked.
  let database = "PostgreSQL (Neon)";
  if (familiarityIncludes(familiarity, "supabase")) database = "PostgreSQL (Supabase)";

  // Hosting
  let hosting = "Vercel";
  if (familiarityIncludes(familiarity, "firebase")) hosting = "Firebase Hosting";
  else if (familiarityIncludes(familiarity, "fly.io", "flyio")) hosting = "Fly.io";
  if (matched?.hostingOverride) hosting = matched.hostingOverride;

  // Auth
  let auth = "Auth.js (NextAuth)";
  if (familiarityIncludes(familiarity, "clerk")) auth = "Clerk";
  else if (familiarityIncludes(familiarity, "auth0")) auth = "Auth0";
  else if (familiarityIncludes(familiarity, "supabase")) auth = "Supabase Auth";
  else if (familiarityIncludes(familiarity, "firebase")) auth = "Firebase Auth";
  if (matched?.authOverride) auth = matched.authOverride;

  return { frontend, backend, database, hosting, auth, nonJsBackend };
}
