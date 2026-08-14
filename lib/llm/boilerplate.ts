import { z } from "zod";
import { MODEL_QUALITY, MODEL_FAST } from "@/lib/groq";
import { callGroqTool } from "@/lib/llm/callTool";
import type { PrdSection } from "@/lib/types";

/** Flat schema — one string field per generated file, same reliability lesson as PRD/stack generation. */
const BoilerplateFillInSchema = z.object({
  mainResourceName: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, "must be lowercase, plural, snake/URL-safe (e.g. 'invoices')"),
  schemaFileContent: z.string().min(1),
  mainRouteFileContent: z.string().min(1),
  homePageFileContent: z.string().min(1),
});

export type BoilerplateFillIn = z.infer<typeof BoilerplateFillInSchema>;

const BOILERPLATE_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_boilerplate_fillin",
    description: "Emit app-specific fill-in content for a Next.js + Drizzle + Postgres starter template.",
    parameters: {
      type: "object",
      properties: {
        mainResourceName: {
          type: "string",
          description: "Lowercase, plural, URL-safe identifier for the app's main data resource (e.g. 'invoices', 'recipes').",
        },
        schemaFileContent: {
          type: "string",
          description:
            "Full content of lib/db/schema.ts: a Drizzle pgTable definition for the main resource, using imports from 'drizzle-orm/pg-core'.",
        },
        mainRouteFileContent: {
          type: "string",
          description:
            "Full content of the main API route file: GET (list) and POST (create) handlers. Next.js App Router route handlers take the request as a direct positional parameter, NOT destructured from an object: `export async function POST(request: Request) { const body = await request.json(); ... }` — never `POST({ request }: {...})`. Import { db } from '@/lib/db/client' and the table from '@/lib/db/schema'.",
        },
        homePageFileContent: {
          type: "string",
          description:
            "Full content of app/page.tsx: a real, app-specific homepage (hero + core feature summary) describing this app. Must NOT query the database directly — keep it static content only, since it needs to build successfully before any database is provisioned.",
        },
      },
      required: ["mainResourceName", "schemaFileContent", "mainRouteFileContent", "homePageFileContent"],
    },
  },
};

function findSection(sections: PrdSection[], key: string): string {
  return sections.find((s) => s.key === key)?.content ?? "";
}

/**
 * v1 scope: fills in one representative slice of the app (schema + one API route + homepage),
 * not the entire application — matches PRD §6.4 ("LLM-generated fill-in for app-specific pieces...
 * rather than generating an entire project from scratch"). The homepage is deliberately static
 * (no live DB call) so the build-validation step (lib/sandbox/validate.ts) tests real compile
 * correctness without also requiring a live database to exist during validation.
 */
export async function generateBoilerplateFillIn(input: {
  prompt: string;
  sections: PrdSection[];
}): Promise<BoilerplateFillIn> {
  const context = [
    `App idea prompt: "${input.prompt}"`,
    `Problem statement: ${findSection(input.sections, "problem_statement")}`,
    `Target user: ${findSection(input.sections, "target_user")}`,
    `Core features: ${findSection(input.sections, "core_features")}`,
    `User stories: ${findSection(input.sections, "user_stories")}`,
  ].join("\n");

  return callGroqTool({
    model: MODEL_QUALITY,
    fallbackModel: MODEL_FAST,
    maxTokens: 3000,
    tool: BOILERPLATE_TOOL,
    userContent: `${context}\n\nGenerate app-specific fill-in for a Next.js (App Router, TypeScript) + Drizzle ORM + Postgres starter, focused on this app's single most central data resource (pick the one core entity the app most revolves around — not every feature, just this slice). Write real, compilable TypeScript — no placeholder comments like "// TODO", no pseudocode. The schema and route must use Drizzle's postgres-js patterns (pgTable, serial/text/timestamp/etc from 'drizzle-orm/pg-core'; db.select()/db.insert() from the client). Route handlers take the request as a plain positional parameter — "export async function POST(request: Request) {" — never destructured from an object. The homepage must be static content only — describe the app, do not call the database.`,
    schema: BoilerplateFillInSchema,
  });
}
