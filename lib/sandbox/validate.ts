import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import type { TemplateFile } from "@/lib/pipeline/template";

export interface ValidationResult {
  passed: boolean;
  log: string;
}

const INSTALL_TIMEOUT_MS = 180_000;
const BUILD_TIMEOUT_MS = 180_000;

/**
 * Interim local-subprocess validator standing in for a real isolated sandbox (Vercel
 * Sandbox / E2B), which was never provisioned (see build plan open item #2). Runs
 * `npm install && npm run build` directly on this host with full host access — fine for
 * local development/testing, NOT safe for a public multi-tenant deployment where prompts
 * (and therefore this generated code) come from untrusted users. Swap this module's
 * implementation for a real sandbox before that happens; callers (the job worker) don't
 * need to change.
 *
 * Timeouts are generous (3 min each) because a cold local `npm install` is genuinely much
 * slower than the PRD's ~60s boilerplate+preview NFR target, which assumes a real cloud
 * sandbox with warm dependency caches. This validator optimizes for correctness while
 * testing, not for hitting that timing target — that's the real sandbox's job.
 */
export async function validateBoilerplate(
  files: TemplateFile[],
  onPhase?: (phase: "install" | "build") => void
): Promise<ValidationResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "wtd-validate-"));
  const log: string[] = [];

  try {
    for (const file of files) {
      const filePath = path.join(dir, ...file.path.split("/"));
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content, "utf8");
    }

    onPhase?.("install");
    log.push(`$ npm install (in ${dir})`);
    const install = await runCommand("npm", ["install", "--no-audit", "--no-fund"], dir, INSTALL_TIMEOUT_MS);
    log.push(install.stdout, install.stderr);
    if (install.code !== 0) {
      return { passed: false, log: log.join("\n") };
    }

    onPhase?.("build");
    log.push("$ npm run build");
    const build = await runCommand("npm", ["run", "build"], dir, BUILD_TIMEOUT_MS);
    log.push(build.stdout, build.stderr);

    return { passed: build.code === 0, log: log.join("\n") };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    // shell:true is required on Windows: .cmd files (npm) aren't real Win32 executables and
    // can't be spawned via execFile without a shell to interpret them — confirmed live that
    // removing it (to silence Node's DEP0190 warning) made the spawn silently no-op instead,
    // hanging the job forever. DEP0190 isn't exploitable here since args are hardcoded
    // literals, never user input, so it's the right one to leave as a warning, not "fix".
    execFile(
      command,
      args,
      { cwd, timeout: timeoutMs, shell: process.platform === "win32", maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout, stderr });
      }
    );
  });
}
