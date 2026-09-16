import type { TemplateFile } from "@/lib/pipeline/template";
import type { PrdSection } from "@/lib/types";
import { generateBoilerplateFillIn } from "@/lib/llm/boilerplate";
import { generateFastapiFillIn } from "@/lib/llm/boilerplateFastapi";
import { buildGeneratedReadme } from "@/lib/pipeline/generatedReadme";
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
  /** Runs whatever check makes sense for this template — both are syntax-only now (no real install/build), see validateSyntax.ts and validate.ts for why. */
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

      const readmeFile = files.find((f) => f.path === "README.md");
      if (readmeFile) {
        readmeFile.content = buildGeneratedReadme({
          prompt: input.prompt,
          sections: input.sections,
          mainResourceName: fillIn.mainResourceName,
          whatsHereLines: [
            `\`app/page.tsx\` — a working ${fillIn.mainResourceName} list + add form, wired to the API route below`,
            `\`app/api/${fillIn.mainResourceName}/route.ts\` — GET (list) / POST (create) for ${fillIn.mainResourceName}`,
            `\`lib/db/schema.ts\` — the ${fillIn.mainResourceName} table`,
          ],
          setupSteps: [
            "1. `npm install`",
            "2. Copy `.env.example` to `.env` and set `DATABASE_URL` to a Postgres connection string.",
            "3. `npm run db:push` to create the schema.",
            "4. `npm run dev` and open http://localhost:3000.",
          ].join("\n"),
        });
      }

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

      const readmeFile = files.find((f) => f.path === "README.md");
      if (readmeFile) {
        readmeFile.content = buildGeneratedReadme({
          prompt: input.prompt,
          sections: input.sections,
          mainResourceName: fillIn.mainResourceName,
          whatsHereLines: [
            `\`main.py\` — FastAPI app plus GET/POST routes for ${fillIn.mainResourceName} (also doubles as the homepage at \`/\` and the interactive docs at \`/docs\`)`,
            `\`models.py\` — the ${fillIn.mainResourceName} SQLAlchemy model`,
          ],
          setupSteps: [
            "1. Create a virtual environment and install dependencies:",
            "   ```",
            "   python -m venv venv",
            "   source venv/bin/activate   # Windows: venv\\Scripts\\activate",
            "   pip install -r requirements.txt",
            "   ```",
            "2. Copy `.env.example` to `.env` and set `DATABASE_URL` to a Postgres connection string.",
            "3. Run the dev server:",
            "   ```",
            "   uvicorn main:app --reload",
            "   ```",
            "4. Open http://localhost:8000/docs for interactive API docs.",
          ].join("\n"),
          extraNote:
            "## Note on validation\n\nThis boilerplate was checked for valid Python syntax before delivery, not run end-to-end (unlike the Next.js template, which gets a real install + build check). Review `main.py` and `models.py` before relying on it.",
        });
      }

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
