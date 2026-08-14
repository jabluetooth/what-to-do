import { z } from "zod";
import { MODEL_QUALITY } from "@/lib/groq";
import { callGroqTool } from "@/lib/llm/callTool";
import { generateCodeFile } from "@/lib/llm/generateCode";
import type { PrdSection } from "@/lib/types";

const RESOURCE_NAME_REGEX = /^[a-z][a-z0-9_]*$/;

const ResourceNameSchema = z.object({
  mainResourceName: z.string().min(1).regex(RESOURCE_NAME_REGEX, "must be lowercase, plural, snake/URL-safe"),
});

const RESOURCE_NAME_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_resource_name",
    description: "Pick this app's single central data resource and name it.",
    parameters: {
      type: "object",
      properties: {
        mainResourceName: {
          type: "string",
          description: "Lowercase, plural, URL-safe identifier for the main resource (e.g. 'invoices', 'trails').",
        },
      },
      required: ["mainResourceName"],
    },
  },
};

export interface BoilerplateFillIn {
  mainResourceName: string;
  schemaFileContent: string;
  mainRouteFileContent: string;
  homePageFileContent: string;
}

function findSection(sections: PrdSection[], key: string): string {
  return sections.find((s) => s.key === key)?.content ?? "";
}

function baseContext(prompt: string, sections: PrdSection[]): string {
  return [
    `App idea prompt: "${prompt}"`,
    `Problem statement: ${findSection(sections, "problem_statement")}`,
    `Target user: ${findSection(sections, "target_user")}`,
    `Core features: ${findSection(sections, "core_features")}`,
  ].join("\n");
}

/** Short, simple, escape-free field — tool-calling is fine here, unlike the code content below. */
async function pickResourceName(input: { prompt: string; sections: PrdSection[] }): Promise<string> {
  const { mainResourceName } = await callGroqTool({
    model: MODEL_QUALITY,
    maxTokens: 100,
    tool: RESOURCE_NAME_TOOL,
    userContent: `${baseContext(input.prompt, input.sections)}\n\nPick the one core data entity this app most revolves around (not every feature — just this slice) and name it.`,
    schema: ResourceNameSchema,
  });
  return mainResourceName;
}

async function generateSchema(input: {
  prompt: string;
  sections: PrdSection[];
  mainResourceName: string;
}): Promise<string> {
  const example = `import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});

export const trails = pgTable("trails", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  rating: integer("rating"),
  categoryId: integer("category_id").references(() => categories.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});`;

  return generateCodeFile({
    model: MODEL_QUALITY,
    maxTokens: 700,
    instructions: `${baseContext(input.prompt, input.sections)}\n\nWrite lib/db/schema.ts for a Drizzle table named "${input.mainResourceName}", following this exact pattern (adapt columns/tables to the app, keep the same import style — every column helper used must be imported from 'drizzle-orm/pg-core'). If the app needs a relationship between two tables, use \`.references(() => otherTable.column)\` directly on the referencing column exactly as shown below — do not import or use \`relationship\`, \`foreignKey\`, \`belongsTo\`, \`many\`, or any other helper name; those do not exist in this API:\n\n${example}`,
  });
}

async function generateRoute(input: {
  prompt: string;
  sections: PrdSection[];
  mainResourceName: string;
  schemaFileContent: string;
}): Promise<string> {
  const example = `import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { trails } from "@/lib/db/schema";

export async function GET(request: Request) {
  const results = await db.select().from(trails);
  return NextResponse.json(results);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { name, description, rating, categoryId } = body;
  const [created] = await db
    .insert(trails)
    .values({ name, description, rating, categoryId })
    .returning();
  return NextResponse.json(created, { status: 201 });
}`;

  return generateCodeFile({
    model: MODEL_QUALITY,
    maxTokens: 600,
    instructions: `${baseContext(input.prompt, input.sections)}\n\nThis is the schema already defined in lib/db/schema.ts:\n\n${input.schemaFileContent}\n\nWrite app/api/${input.mainResourceName}/route.ts with GET (list) and POST (create) handlers, following this exact pattern — request is a plain positional parameter, never destructured from an object, and the table is referenced by its actual imported binding (e.g. \`.from(trails)\`), never as a string like \`.from('trails')\`. Critically, POST must NEVER pass the raw parsed body straight into \`.values(...)\`: destructure only the specific writable columns your schema actually defines (skip \`id\`, \`createdAt\`, and any other auto-generated/computed column) into a plain object first, exactly as shown, so a caller can't inject values for columns that don't belong in a create request:\n\n${example}`,
  });
}

async function generateHomePage(input: { prompt: string; sections: PrdSection[] }): Promise<string> {
  return generateCodeFile({
    model: MODEL_QUALITY,
    maxTokens: 600,
    instructions: `${baseContext(input.prompt, input.sections)}\n\nWrite app/page.tsx as a real React Server Component (default export, no props) with static, app-specific content — a hero section and a short feature summary reflecting this exact app idea, not generic placeholder text. Do not import or call the database.`,
  });
}

/**
 * v1 scope: fills in one representative slice of the app (schema + one API route + homepage),
 * not the entire application — matches PRD §6.4. Resource naming uses tool-calling (short,
 * simple, escape-free); the three code files use generateCodeFile's plain-text-plus-fence
 * approach instead — see that module for why. The route call is given the already-generated
 * schema as context so they agree with each other (same table binding, same columns). Schema
 * and homepage don't depend on each other and run in parallel; the route call needs the
 * schema's content first.
 *
 * None of the four calls below pass a fallbackModel (PRD §7): boilerplate generation is the
 * one stage required to fail fast on rate-limit rather than transparently degrade to the
 * weaker model mid-job, which has proven unreliable enough at code generation that finishing
 * a job on it just wastes a full install+build cycle. The pre-flight isModelExhausted check in
 * the route handler catches the common case; this is what makes a mid-job 429 actually fail
 * instead of silently continuing on a worse model.
 */
export async function generateBoilerplateFillIn(input: {
  prompt: string;
  sections: PrdSection[];
}): Promise<BoilerplateFillIn> {
  const mainResourceName = await pickResourceName(input);

  const [schemaFileContent, homePageFileContent] = await Promise.all([
    generateSchema({ ...input, mainResourceName }),
    generateHomePage(input),
  ]);

  const mainRouteFileContent = await generateRoute({ ...input, mainResourceName, schemaFileContent });

  return { mainResourceName, schemaFileContent, mainRouteFileContent, homePageFileContent };
}
