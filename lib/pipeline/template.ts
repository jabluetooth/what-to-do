import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { StackRecommendation } from "@/lib/types";

export interface TemplateFile {
  /** Relative path within the generated project, e.g. "app/page.tsx". */
  path: string;
  content: string;
}

const TEMPLATES_ROOT = path.join(process.cwd(), "templates");

export const SEED_TEMPLATE_ID = "nextjs-postgres-drizzle";
export const FASTAPI_TEMPLATE_ID = "fastapi-postgres";

/**
 * Maps the recommended stack's backend pick to an actual template on disk — this is what makes
 * boilerplate generation match what was recommended instead of always defaulting to Next.js.
 * stackMatrix.ts's pickStack() is deliberately constrained to only ever recommend a backend one
 * of these two branches covers (see its own doc comment), so this stays a closed, exhaustive
 * mapping rather than needing a fallback for an unrecognized backend string.
 */
export function resolveTemplateId(stack: StackRecommendation | undefined): string {
  if (stack?.backend.choice === "FastAPI (Python)") return FASTAPI_TEMPLATE_ID;
  return SEED_TEMPLATE_ID;
}

/** True for templates that run in-browser via WebContainer (JS/TS only) — see PRD §6.5 and lib/types.ts's `boilerplateWebContainerCompatible`. */
export function isWebContainerCompatible(templateId: string): boolean {
  return templateId === SEED_TEMPLATE_ID;
}

async function walk(dir: string, baseDir: string): Promise<TemplateFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: TemplateFile[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath, baseDir)));
    } else {
      const relativePath = path.relative(baseDir, fullPath).split(path.sep).join("/");
      const content = await readFile(fullPath, "utf8");
      files.push({ path: relativePath, content });
    }
  }

  return files;
}

export async function loadTemplate(templateId: string = SEED_TEMPLATE_ID): Promise<TemplateFile[]> {
  const templateDir = path.join(TEMPLATES_ROOT, templateId);
  return walk(templateDir, templateDir);
}
