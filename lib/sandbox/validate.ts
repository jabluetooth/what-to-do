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
}

const INSTALL_TIMEOUT_MS = 180_000;
const BUILD_TIMEOUT_MS = 180_000;

/**
 * Names of env vars corepack/pnpm/node/the OS shell actually need to run the install/build.
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

function buildChildEnv(fakeHome: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  // NODE_ENV is non-optional on NodeJS.ProcessEnv's type (Next.js's own ambient declaration) —
  // `next build` forces production mode internally regardless, so this doesn't change behavior.
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  const lookup = new Map(Object.entries(process.env).map(([key, value]) => [key.toUpperCase(), value]));
  for (const key of INHERITED_ENV_KEYS) {
    const value = lookup.get(key);
    if (value !== undefined) env[key] = value;
  }
  env.HOME = fakeHome;
  return { ...env, ...extra };
}

/**
 * pnpm (via corepack, bundled with Node itself) instead of npm: npm keeps a compressed tarball
 * cache AND a fully-unpacked node_modules simultaneously, so peak disk during install is
 * roughly 1.5-2x actual package content — on a small fixed /tmp quota (e.g. Vercel Hobby's
 * 512MB) that alone was enough to hit ENOSPC even with a shared cache and a trimmed dep list.
 * pnpm keeps exactly one physical copy of each package's content in this store and hardlinks it
 * into node_modules, so repeat installs of the same (unchanged, non-LLM-controlled — see
 * template.ts) template dependencies cost close to zero additional disk after the first job on
 * a given container. Deliberately NOT inside the per-job tmpdir and never deleted here, for the
 * same reuse-across-jobs reasoning the old shared npm cache dir had.
 */
const SHARED_PNPM_STORE_DIR = path.join(tmpdir(), "wtd-validate-pnpm-store");

/** Where corepack caches the pnpm CLI package itself — shared for the same reason as the store above (small, but no reason to re-fetch it every job). */
const SHARED_COREPACK_HOME = path.join(tmpdir(), "wtd-validate-corepack-home");

/**
 * Interim local-subprocess validator standing in for a real isolated sandbox (Vercel
 * Sandbox / E2B), which was never provisioned (see build plan open item #2). Runs
 * `pnpm install` then the built app's own build binary directly on this host — fine for local
 * development/testing,
 * NOT safe for a public multi-tenant deployment where prompts (and therefore this generated
 * code) come from untrusted users: there's no filesystem/process isolation, only an env
 * allowlist (buildChildEnv) keeping app secrets out of the child process's reach. Swap this
 * module's implementation for a real sandbox before real traffic; callers (the job worker)
 * don't need to change.
 *
 * pnpm via `corepack` (bundled with Node itself, no separate install needed) rather than npm —
 * see SHARED_PNPM_STORE_DIR's doc comment for why.
 *
 * Timeouts are generous (3 min each) because a cold local install is genuinely much slower than
 * the PRD's ~60s boilerplate+preview NFR target, which assumes a real cloud sandbox with warm
 * dependency caches. This validator optimizes for correctness while testing, not for hitting
 * that timing target — that's the real sandbox's job.
 */
export async function validateBoilerplate(
  files: TemplateFile[],
  onPhase?: (phase: "install" | "build") => void | Promise<void>
): Promise<ValidationResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "wtd-validate-"));
  // On Vercel's serverless filesystem, $HOME points at a directory that doesn't actually
  // exist (only /tmp is writable there), so npm's/pnpm's default config resolution fails with
  // ENOENT before it can even reach the network. Pointing HOME at a directory we just created
  // under the OS temp dir sidesteps that without touching the parent process's real environment.
  const fakeHome = path.join(dir, ".home");
  await mkdir(fakeHome, { recursive: true });
  await mkdir(SHARED_PNPM_STORE_DIR, { recursive: true });
  await mkdir(SHARED_COREPACK_HOME, { recursive: true });
  const childEnv = buildChildEnv(fakeHome, { COREPACK_HOME: SHARED_COREPACK_HOME });
  const log: string[] = [];

  try {
    for (const file of files) {
      const filePath = path.join(dir, ...file.path.split("/"));
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content, "utf8");
    }

    await onPhase?.("install");
    log.push(`$ corepack pnpm install (in ${dir})`);
    const install = await runCommand(
      "corepack",
      ["pnpm", "install", "--ignore-scripts", "--store-dir", SHARED_PNPM_STORE_DIR],
      dir,
      INSTALL_TIMEOUT_MS,
      childEnv
    );
    log.push(install.stdout, install.stderr);
    if (install.code !== 0) {
      const diskFull = noteIfDiskFull(log, install.stdout, install.stderr);
      return { passed: false, log: log.join("\n"), diskFull };
    }

    await onPhase?.("build");
    // Invokes the installed `next` binary directly rather than `corepack pnpm run build`:
    // confirmed live that pnpm's `run`/`exec` both perform a dependency-status self-check that
    // shells out to a bare, unqualified `pnpm` — which isn't on PATH when pnpm is only reachable
    // via `corepack pnpm` (no `corepack enable` shim installed), and fails the whole step even
    // though the actual build would have succeeded. `pnpm install` above doesn't hit this; only
    // `run`/`exec` do. If a future template's build step isn't a `next build`, this needs a
    // per-template binary/command, same as multi-stack template support already will.
    const nextBin = path.join(dir, "node_modules", ".bin", "next");
    log.push(`$ ${nextBin} build`);
    const build = await runCommand(nextBin, ["build"], dir, BUILD_TIMEOUT_MS, childEnv);
    log.push(build.stdout, build.stderr);
    const buildDiskFull = build.code !== 0 && noteIfDiskFull(log, build.stdout, build.stderr);

    return { passed: build.code === 0, log: log.join("\n"), diskFull: buildDiskFull };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * ENOSPC here means the platform's ephemeral disk quota (e.g. Vercel Hobby's fixed 512MB
 * /tmp) filled up mid-install/build — a real limitation of this interim local-subprocess
 * validator (see its module doc comment), not a problem with the generated code. Surfacing
 * it distinctly in the log means a failed job doesn't get misread as bad LLM output, and the
 * returned boolean lets the caller refund the generation cap for what wasn't the user's fault.
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
