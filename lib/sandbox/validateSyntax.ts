import ts from "typescript";
import type { TemplateFile } from "@/lib/pipeline/template";
import type { ValidationResult } from "@/lib/sandbox/validate";

const TS_EXTENSIONS = [".ts", ".tsx"];

/**
 * Parses each generated TS/TSX file's content directly with the TypeScript compiler API
 * (ts.transpileModule) — no disk write, no dependency install, no node_modules at all. This
 * exists because the previous check (validateBoilerplate: a real `pnpm install && next build`
 * in /tmp) reliably hit ENOSPC on free-tier serverless disk quotas (Vercel Hobby's 512MB), per
 * live production reports. `transpileModule` only reports *syntactic* diagnostics (parse
 * errors — the "Expression expected" class of bug actually seen from Groq, e.g. `default
 * export function App()` instead of `export default function App()`) since it never resolves
 * imports or type-checks; it will NOT catch a wrong import path, a mismatched API call, or any
 * error that only surfaces once real dependencies are involved. That deeper check now happens
 * client-side, for free, the first time someone opens the live preview (a real WebContainer
 * install+dev-server boot) — see app/preview/[ref]/page.tsx and the boilerplateBuildVerified
 * session field it reports back to.
 */
export async function validateTypeScriptSyntax(
  files: TemplateFile[],
  onPhase?: (phase: "install" | "build") => void | Promise<void>
): Promise<ValidationResult> {
  await onPhase?.("build");

  const log: string[] = [];
  let passed = true;

  for (const file of files) {
    if (!TS_EXTENSIONS.some((ext) => file.path.endsWith(ext))) continue;

    const result = ts.transpileModule(file.content, {
      fileName: file.path,
      reportDiagnostics: true,
      compilerOptions: {
        jsx: ts.JsxEmit.Preserve,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    });

    for (const diagnostic of result.diagnostics ?? []) {
      passed = false;
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      if (diagnostic.file && diagnostic.start !== undefined) {
        const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        log.push(`${file.path}:${line + 1}:${character + 1} - ${message}`);
      } else {
        log.push(`${file.path} - ${message}`);
      }
    }
  }

  if (passed) log.push(`Syntax check passed for ${files.filter((f) => TS_EXTENSIONS.some((e) => f.path.endsWith(e))).length} TypeScript/TSX file(s).`);

  return { passed, log: log.join("\n"), diskFull: false };
}
