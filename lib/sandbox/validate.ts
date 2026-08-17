import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import type { TemplateFile } from "@/lib/pipeline/template";

export interface ValidationResult {
  passed: boolean;
  log: string;
  /** True when the failure was the sandbox running out of local disk quota, not a bad generation. */
  diskFull: boolean;
  /** True when passed=true only because no real check could run (e.g. no Python interpreter on this host) — not the same as an actually-verified pass. */
  unvalidated?: boolean;
}

const PYTHON_CHECK_TIMEOUT_MS = 30_000;

/**
 * Names of env vars the OS shell / a spawned interpreter actually need. Everything else in the
 * real process.env (every app secret: DATABASE_URL, R2/Groq/QStash/Auth credentials) is
 * deliberately left out — the files checked here are LLM-generated from untrusted user prompts.
 */
const INHERITED_ENV_KEYS = [
  "PATH",
  "TEMP",
  "TMP",
  "TMPDIR",
  // Windows-only, needed for `shell: true` (cmd.exe) and node itself to function there.
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  "WINDIR",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
];

function buildChildEnv(fakeHome: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  // NODE_ENV is non-optional on NodeJS.ProcessEnv's type (Next.js's own ambient declaration).
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  const lookup = new Map(Object.entries(process.env).map(([key, value]) => [key.toUpperCase(), value]));
  for (const key of INHERITED_ENV_KEYS) {
    const value = lookup.get(key);
    if (value !== undefined) env[key] = value;
  }
  env.HOME = fakeHome;
  return { ...env, ...extra };
}

async function writeFilesToDir(dir: string, files: TemplateFile[]): Promise<void> {
  for (const file of files) {
    const filePath = path.join(dir, ...file.path.split("/"));
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content, "utf8");
  }
}

const PYTHON_CANDIDATES = ["python3", "python"];

/**
 * Finds a usable Python interpreter, or null if none is on PATH. Distinct from a command that
 * ran and failed (see runCommand's spawnFailed) — this only checks for the binary's existence.
 */
async function findPythonBinary(cwd: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  for (const candidate of PYTHON_CANDIDATES) {
    const probe = await runCommand(candidate, ["--version"], cwd, 10_000, env);
    if (!probe.spawnFailed) return candidate;
  }
  return null;
}

/**
 * Every template's boilerplate validation is now a syntax-only check with no real install
 * (lib/sandbox/validateSyntax.ts covers the JS/TS template; this covers Python/FastAPI) — a
 * real `pnpm install && next build` used to run here for the JS/TS path but reliably exhausted
 * free-tier serverless disk quotas (ENOSPC), confirmed live in production, and was removed. The
 * deeper "does this actually install and run" check now happens client-side, lazily, the first
 * time someone opens the live preview (WebContainer-compatible templates only — see
 * app/preview/[ref]/page.tsx and lib/types.ts's boilerplateBuildVerified).
 *
 * Deliberately does NOT pip install or run the generated app: this is a Node.js serverless
 * function (Vercel), and there's no guarantee a Python interpreter — let alone one with network
 * access to pip-install a real dependency set — is even present in that runtime. Checks only
 * that the LLM's Python is syntactically valid (`py_compile`, stdlib only, no dependencies
 * needed) and degrades gracefully — `unvalidated: true`, not a failure — when no Python
 * interpreter is found at all, rather than blocking every FastAPI generation on a platform
 * capability this validator can't assume.
 */
export async function validateFastapiBoilerplate(
  files: TemplateFile[],
  onPhase?: (phase: "install" | "build") => void | Promise<void>
): Promise<ValidationResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "wtd-validate-py-"));
  const fakeHome = path.join(dir, ".home");
  await mkdir(fakeHome, { recursive: true });
  // py_compile writes __pycache__/*.pyc by default — harmless, but there's no reason to.
  const childEnv = buildChildEnv(fakeHome, { PYTHONDONTWRITEBYTECODE: "1" });
  const log: string[] = [];

  try {
    await writeFilesToDir(dir, files);

    await onPhase?.("build");
    const pythonBin = await findPythonBinary(dir, childEnv);
    if (!pythonBin) {
      log.push(
        "NOTE: no Python interpreter found in this environment — skipped syntax validation. " +
          "Review the generated Python locally before running it."
      );
      return { passed: true, log: log.join("\n"), diskFull: false, unvalidated: true };
    }

    const pyFiles = files.filter((f) => f.path.endsWith(".py")).map((f) => f.path);
    log.push(`$ ${pythonBin} -m py_compile ${pyFiles.join(" ")}`);
    const check = await runCommand(pythonBin, ["-m", "py_compile", ...pyFiles], dir, PYTHON_CHECK_TIMEOUT_MS, childEnv);
    log.push(check.stdout, check.stderr);
    const diskFull = check.code !== 0 && noteIfDiskFull(log, check.stdout, check.stderr);

    return { passed: check.code === 0, log: log.join("\n"), diskFull };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * ENOSPC here means the platform's ephemeral disk quota (e.g. Vercel Hobby's fixed 512MB
 * /tmp) filled up — surfacing it distinctly in the log means a failed job doesn't get misread
 * as bad LLM output, and the returned boolean lets the caller refund the generation cap for
 * what wasn't the user's fault.
 */
function noteIfDiskFull(log: string[], stdout: string, stderr: string): boolean {
  const diskFull = stdout.includes("ENOSPC") || stderr.includes("ENOSPC");
  if (diskFull) {
    log.push(
      "\nNOTE: this failure was \"no space left on device\" (ENOSPC), not a code generation " +
        "problem — the sandbox validator ran out of local disk quota (common on free-tier " +
        "serverless /tmp limits). Retrying may succeed on a fresh container."
    );
  }
  return diskFull;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  /**
   * True when the binary itself couldn't be found/launched (Node spawn error, e.g. ENOENT) —
   * distinct from the binary running and exiting non-zero. Only reliable with shell:false
   * (Linux/production): on Windows' shell:true path a missing binary surfaces as a normal
   * nonzero exit from cmd.exe's own "not recognized" message, not a Node spawn error, so this
   * stays false there even for a genuinely missing command.
   */
  spawnFailed: boolean;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv
): Promise<CommandResult> {
  return new Promise((resolve) => {
    // shell:true is required on Windows: .cmd files (npm) aren't real Win32 executables and
    // can't be spawned via execFile without a shell to interpret them — confirmed live that
    // removing it (to silence Node's DEP0190 warning) made the spawn silently no-op instead,
    // hanging the job forever. DEP0190 isn't exploitable here since args are hardcoded
    // literals, never user input, so it's the right one to leave as a warning, not "fix".
    execFile(
      command,
      args,
      { cwd, env, timeout: timeoutMs, shell: process.platform === "win32", maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const spawnFailed = !!error && typeof error.code !== "number";
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout, stderr, spawnFailed });
      }
    );
  });
}
