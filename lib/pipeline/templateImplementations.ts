import type { TemplateFile } from "@/lib/pipeline/template";
import type { PrdSection } from "@/lib/types";
import { generateBoilerplateFillIn } from "@/lib/llm/boilerplate";
import { generateFastapiFillIn } from "@/lib/llm/boilerplateFastapi";
import { validateFastapiBoilerplate, type ValidationResult } from "@/lib/sandbox/validate";
import { validateTypeScriptSyntax } from "@/lib/sandbox/validateSyntax";

/**
 * Server-only half of a template's definition, keyed by the same id as its
 * templateRegistry.ts TemplateDescriptor — split into a separate file (and module graph) so
 * that stackMatrix.ts, which app/page.tsx (a client component) needs for STACK_ALTERNATIVES,
 * never pulls in these Node-only dependencies (child_process, fs) into a browser bundle.
 * Only boilerplateWorker.ts imports this, and it only ever runs server-side (a QStash-triggered
 * job).
 */
export interface TemplateImplementation {
  /** User-facing progress messages for validate()'s onPhase callback; a phase with no entry here just doesn't report a message for that step. */
  phaseMessages: Partial<Record<"install" | "build", string>>;
  /**
   * Generates this template's LLM fill-in content and returns the complete file list (template
   * files with the generated content merged in, plus any new files). onProgress lets each
   * template report as many/few sub-steps as its own generation actually has — Next.js reports
   * two (schema+route, then homepage); FastAPI reports one (no separate homepage call needed,
   * see boilerplateFastapi.ts).
   */
  generateFillIn(
    templateFiles: TemplateFile[],
    input: { prompt: string; sections: PrdSection[] },
    onProgress: (progress: number, message: string) => Promise<void>
  ): Promise<TemplateFile[]>;
  /** Runs whatever install/build/syntax check makes sense for this template; see validate.ts for why this differs so much between templates (real install+build for JS, syntax-only for Python). */
  validate(files: TemplateFile[], onPhase: (phase: "install" | "build") => void | Promise<void>): Promise<ValidationResult>;
}

const IMPLEMENTATIONS: Record<string, TemplateImplementation> = {
  "nextjs-postgres-drizzle": {
    // No "install" phase anymore — validateTypeScriptSyntax never touches disk (see its own
    // doc comment for why: the previous real pnpm install+build reliably hit ENOSPC on
    // free-tier serverless /tmp quotas). The deeper "does this actually install and run" check
    // now happens client-side the first time someone opens the live preview.
    phaseMessages: { build: "Checking syntax..." },
    async generateFillIn(templateFiles, input, onProgress) {
      await onProgress(20, "Generating routes & models...");
      const fillIn = await generateBoilerplateFillIn(input);
      await onProgress(45, "Generating initial UI...");

      const files = templateFiles.map((f) => ({ ...f }));
      const schemaFile = files.find((f) => f.path === "lib/db/schema.ts");
      if (schemaFile) schemaFile.content = fillIn.schemaFileContent;
      const pageFile = files.find((f) => f.path === "app/page.tsx");
      if (pageFile) pageFile.content = fillIn.homePageFileContent;
      files.push({ path: `app/api/${fillIn.mainResourceName}/route.ts`, content: fillIn.mainRouteFileContent });
      return files;
    },
    validate: validateTypeScriptSyntax,
  },
  "fastapi-postgres": {
    phaseMessages: { build: "Checking generated Python..." },
    async generateFillIn(templateFiles, input, onProgress) {
      await onProgress(20, "Generating models & routes...");
      const fillIn = await generateFastapiFillIn(input);

      const files = templateFiles.map((f) => ({ ...f }));
      const modelsFile = files.find((f) => f.path === "models.py");
      if (modelsFile) modelsFile.content = fillIn.modelsFileContent;
      const mainFile = files.find((f) => f.path === "main.py");
      if (mainFile) mainFile.content = fillIn.mainFileContent;
      return files;
    },
    validate: validateFastapiBoilerplate,
  },
};

export function getTemplateImplementation(id: string): TemplateImplementation {
  const impl = IMPLEMENTATIONS[id];
  if (!impl) throw new Error(`No template implementation registered for id "${id}" — check templateImplementations.ts.`);
  return impl;
}
