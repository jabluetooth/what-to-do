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
 * Names of env vars npm/node/the OS shell actually need to run `npm install`/`npm run build`.
 * Everything else in the real process.env (every app secret: DATABASE_URL, R2/Groq/QStash/Auth
 * credentials) is deliberately left out — the files being built here are LLM-generated from
 * untrusted user prompts, and `next build` executes that code (prerendering) as part of this
 * same install+build step. Spreading the full process.env into that child process would hand
 * every production credential to code an attacker can influence via prompt injection.
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

function buildChildEnv(fakeHome: string, npmCacheDir: string): NodeJS.ProcessEnv {
  // NODE_ENV is non-optional on NodeJS.ProcessEnv's type (Next.js's own ambient declaration) —
  // `next build` forces production mode internally regardless, so this doesn't change behavior.
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  const lookup = new Map(Object.entries(process.env).map(([key, value]) => [key.toUpperCase(), value]));
  for (const key of INHERITED_ENV_KEYS) {
    const value = lookup.get(key);
    if (value !== undefined) env[key] = value;
  }
  env.HOME = fakeHome;
  env.npm_config_cache = npmCacheDir;
  return env;
}

/**
 * Deliberately NOT inside the per-job tmpdir, and never deleted here: every job installs the
 * exact same template dependencies (package.json is static, never LLM-filled — see template.ts),
 * so on a warm container this lets a second job reuse tarballs the first one already downloaded
 * instead of re-fetching the whole tree from scratch. That matters on platforms with a small,
 * fixed /tmp quota (e.g. Vercel Hobby's 512MB): a cache dir that used to be recreated and thrown
 * away per job meant every single job paid the full download+unpack cost, which is the main
 * thing that pushes a small-quota /tmp into ENOSPC. Safe to share: content is registry tarballs
 * for fixed, non-LLM-controlled package names/versions, not attacker-influenced.
 */
const SHARED_NPM_CACHE_DIR = path.join(tmpdir(), "wtd-validate-npm-cache");

/** Dev-only tooling the shipped template lists for the user's own later `db:push`, not needed to prove `next build` succeeds — dropping it from the validate-only install trims real peak disk usage without changing what actually ships. */
const VALIDATE_ONLY_STRIP_DEV_DEPS = ["drizzle-kit"];

function stripValidateOnlyDeps(packageJsonContent: string): string {
  try {
    const pkg = JSON.parse(packageJsonContent);
    if (pkg.devDependencies) {
      for (const dep of VALIDATE_ONLY_STRIP_DEV_DEPS) delete pkg.devDependencies[dep];
    }
    return JSON.stringify(pkg, null, 2);
  } catch {
    return packageJsonContent;
  }
}

/**
 * Interim local-subprocess validator standing in for a real isolated sandbox (Vercel
 * Sandbox / E2B), which was never provisioned (see build plan open item #2). Runs
 * `npm install && npm run build` directly on this host — fine for local development/testing,
 * NOT safe for a public multi-tenant deployment where prompts (and therefore this generated
 * code) come from untrusted users: there's no filesystem/process isolation, only an env
 * allowlist (buildChildEnv) keeping app secrets out of the child process's reach. Swap this
 * module's implementation for a real sandbox before real traffic; callers (the job worker)
 * don't need to change.
 *
 * Timeouts are generous (3 min each) because a cold local `npm install` is genuinely much
 * slower than the PRD's ~60s boilerplate+preview NFR target, which assumes a real cloud
 * sandbox with warm dependency caches. This validator optimizes for correctness while
 * testing, not for hitting that timing target — that's the real sandbox's job.
 */
export async function validateBoilerplate(
  files: TemplateFile[],
  onPhase?: (phase: "install" | "build") => void | Promise<void>
): Promise<ValidationResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "wtd-validate-"));
  // On Vercel's serverless filesystem, $HOME points at a directory that doesn't actually
  // exist (only /tmp is writable there), so npm's default ~/.npm cache/config resolution
  // fails with ENOENT before it can even reach the network. Pointing HOME/npm's cache at a
  // directory we just created under the OS temp dir sidesteps that without touching the
  // parent process's real environment.
  const fakeHome = path.join(dir, ".home");
  await mkdir(fakeHome, { recursive: true });
  await mkdir(SHARED_NPM_CACHE_DIR, { recursive: true });
  const npmEnv = buildChildEnv(fakeHome, SHARED_NPM_CACHE_DIR);
  const log: string[] = [];

  try {
    for (const file of files) {
      const filePath = path.join(dir, ...file.path.split("/"));
      await mkdir(path.dirname(filePath), { recursive: true });
      const content = file.path === "package.json" ? stripValidateOnlyDeps(file.content) : file.content;
      await writeFile(filePath, content, "utf8");
    }

    await onPhase?.("install");
    log.push(`$ npm install (in ${dir})`);
    const install = await runCommand(
      "npm",
      ["install", "--no-audit", "--no-fund", "--ignore-scripts"],
      dir,
      INSTALL_TIMEOUT_MS,
      npmEnv
    );
    log.push(install.stdout, install.stderr);
    if (install.code !== 0) {
      noteIfDiskFull(log, install.stdout, install.stderr);
      return { passed: false, log: log.join("\n") };
    }

    await onPhase?.("build");
    log.push("$ npm run build");
    const build = await runCommand("npm", ["run", "build"], dir, BUILD_TIMEOUT_MS, npmEnv);
    log.push(build.stdout, build.stderr);
    if (build.code !== 0) {
      noteIfDiskFull(log, build.stdout, build.stderr);
    }

    return { passed: build.code === 0, log: log.join("\n") };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * ENOSPC here means the platform's ephemeral disk quota (e.g. Vercel Hobby's fixed 512MB
 * /tmp) filled up mid-install/build — a real limitation of this interim local-subprocess
 * validator (see its module doc comment), not a problem with the generated code. Surfacing
 * it distinctly in the log means a failed job doesn't get misread as bad LLM output.
 */
function noteIfDiskFull(log: string[], stdout: string, stderr: string): void {
  if (stdout.includes("ENOSPC") || stderr.includes("ENOSPC")) {
    log.push(
      "\nNOTE: this failure was \"no space left on device\" (ENOSPC), not a code generation " +
        "problem — the sandbox validator ran out of local disk quota (common on free-tier " +
        "serverless /tmp limits). Retrying may succeed on a fresh container."
    );
  }
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
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
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout, stderr });
      }
    );
  });
}
