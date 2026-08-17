import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface TemplateFile {
  /** Relative path within the generated project, e.g. "app/page.tsx". */
  path: string;
  content: string;
}

const TEMPLATES_ROOT = path.join(process.cwd(), "templates");

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

/** Loads a template's file tree by id (matches its folder name under templates/) — see templateRegistry.ts for how a stack pick resolves to a template id. */
export async function loadTemplate(templateId: string): Promise<TemplateFile[]> {
  const templateDir = path.join(TEMPLATES_ROOT, templateId);
  return walk(templateDir, templateDir);
}
