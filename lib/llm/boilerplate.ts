import { MODEL_QUALITY } from "@/lib/groq";
import { generateCodeFile } from "@/lib/llm/generateCode";
import { baseContext, pickResourceName } from "@/lib/llm/boilerplateShared";
import type { PrdSection } from "@/lib/types";

export interface BoilerplateFillIn {
  mainResourceName: string;
  schemaFileContent: string;
  mainRouteFileContent: string;
  homePageFileContent: string;
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

async function generateHomePage(input: {
  prompt: string;
  sections: PrdSection[];
  mainResourceName: string;
  schemaFileContent: string;
}): Promise<string> {
  const example = `"use client";

import { useEffect, useState, type FormEvent } from "react";

interface Trail {
  id: number;
  name: string;
  description: string | null;
  rating: number | null;
}

export default function Home() {
  const [trails, setTrails] = useState<Trail[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    fetch("/api/trails")
      .then((res) => res.json())
      .then(setTrails);
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await fetch("/api/trails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    const created = await res.json();
    setTrails((prev) => [...prev, created]);
    setName("");
    setDescription("");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-16">
      <section className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">Trail Finder</h1>
        <p className="mt-2 text-lg text-gray-600">Discover and rate hiking trails near you.</p>
      </section>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Trail name"
          className="rounded border border-gray-300 px-3 py-2"
          required
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          className="rounded border border-gray-300 px-3 py-2"
        />
        <button type="submit" className="rounded bg-gray-900 px-4 py-2 font-medium text-white">
          Add trail
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {trails.map((trail) => (
          <li key={trail.id} className="rounded-lg border border-gray-200 p-4">
            <p className="font-semibold text-gray-900">{trail.name}</p>
            <p className="text-gray-600">{trail.description}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}`;

  return generateCodeFile({
    model: MODEL_QUALITY,
    maxTokens: 1100,
    instructions: `${baseContext(input.prompt, input.sections)}\n\nThis is the schema already defined in lib/db/schema.ts for the "${input.mainResourceName}" resource:\n\n${input.schemaFileContent}\n\nWrite app/page.tsx as a real, interactive client component wired to the already-generated app/api/${input.mainResourceName}/route.ts — not a static brochure page. Following this exact pattern (adapt headings, the resource's actual column names, and the endpoint path to match): start with "use client", fetch the list from /api/${input.mainResourceName} on mount and render each item using the schema's real columns (never invent fields that aren't in the schema above), include a form with one input per writable column (skip id/createdAt/any computed column) that POSTs a new item and appends it to the list on success, and open with a one-line heading/subheading reflecting this specific app idea. Keep the same import style: react hooks imported explicitly from 'react' (JSX itself needs no import). Do not import or call the database directly — only fetch() the API route.\n\nTailwind CSS v4 is already configured in this project (globals.css imports it directly) — use Tailwind utility classes on every element, exactly as densely as the pattern below, so the page renders as a real styled layout instead of unstyled semantic HTML. Do not omit className attributes.\n\n${example}`,
  });
}

/**
 * v1 scope: fills in one representative slice of the app (schema + one API route + a homepage
 * wired to that route), not the entire application — matches PRD §6.4. Resource naming uses
 * tool-calling (short, simple, escape-free); the three code files use generateCodeFile's
 * plain-text-plus-fence approach instead — see that module for why. Both the route and the
 * homepage are given the already-generated schema as context so all three agree with each
 * other (same table binding, same columns, same endpoint) — the homepage renders and posts to
 * the exact resource the route actually serves, instead of being a disconnected static page.
 * Schema must therefore run first; route and homepage don't depend on each other and run in
 * parallel once it's done.
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
  const schemaFileContent = await generateSchema({ ...input, mainResourceName });

  const [mainRouteFileContent, homePageFileContent] = await Promise.all([
    generateRoute({ ...input, mainResourceName, schemaFileContent }),
    generateHomePage({ ...input, mainResourceName, schemaFileContent }),
  ]);

  return { mainResourceName, schemaFileContent, mainRouteFileContent, homePageFileContent };
}
