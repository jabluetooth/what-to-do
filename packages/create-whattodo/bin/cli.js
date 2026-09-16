#!/usr/bin/env node
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { clearLine, cursorTo } from "node:readline";
import { stdin, stdout } from "node:process";
import JSZip from "jszip";

const DEFAULT_API = "https://whattodoby.filheinzrelatorre.com";
const GUEST_COOKIE_NAME = "wtd_guest_sid";
const JOB_POLL_INTERVAL_MS = 2000;
const JOB_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CLARIFICATION_ROUNDS = 3;

// --- terminal styling ------------------------------------------------------
// Hand-rolled ANSI helpers instead of a dependency — a handful of escape codes
// isn't worth pulling in chalk/picocolors for. Disabled for non-TTY output
// (piped/redirected) and when NO_COLOR is set, so scripted/CI usage never gets
// raw escape codes mixed into its output.
const isTTY = Boolean(stdout.isTTY);
const colorEnabled = isTTY && !("NO_COLOR" in process.env) && process.env.TERM !== "dumb";

function paint(code) {
  return (text) => (colorEnabled ? `\x1b[${code}m${text}\x1b[0m` : String(text));
}
const bold = paint("1");
const dim = paint("2");
const cyan = paint("36");
const green = paint("32");
const yellow = paint("33");
const red = paint("31");

function step(label) {
  console.log(`\n${bold(cyan("▸"))} ${bold(label)}`);
}
function success(label) {
  console.log(`${green("✔")} ${label}`);
}
function warn(label) {
  console.log(`${yellow("!")} ${label}`);
}
function fail(label) {
  console.error(`${red("✖")} ${label}`);
}

/** Live-updating single-line spinner on a TTY; plain sequential log lines otherwise. */
function createSpinner(initialLabel) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let label = initialLabel;

  if (!isTTY) {
    console.log(`  ${label}`);
    return {
      update(text) {
        label = text;
        console.log(`  ${label}`);
      },
      stop(finalText) {
        if (finalText) console.log(finalText);
      },
    };
  }

  let frame = 0;
  stdout.write(`  ${cyan(frames[0])} ${label}`);
  const timer = setInterval(() => {
    frame = (frame + 1) % frames.length;
    clearLine(stdout, 0);
    cursorTo(stdout, 0);
    stdout.write(`  ${cyan(frames[frame])} ${label}`);
  }, 80);

  return {
    update(text) {
      label = text;
    },
    stop(finalText) {
      clearInterval(timer);
      clearLine(stdout, 0);
      cursorTo(stdout, 0);
      if (finalText) console.log(finalText);
    },
  };
}
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
${bold(cyan("create-whattodo"))} ${dim("— scaffold a real project from a one-sentence idea")}

${bold("Usage:")}
  npx create-whattodo "a tool that tracks my reading list" [options]
  npx create-whattodo                 ${dim("(prompts for the idea interactively)")}

${bold("Options:")}
  --dir <name>        Target directory name (default: derived from your idea)
  --platform <kind>   web | mobile
  --scope <size>      weekend | mvp | production
  --known <stacks>    Stacks you already know, e.g. "React, Postgres"
  --local             Use http://localhost:3000 instead of the live API
  --api <url>         Use a custom API base URL
  -y, --yes           Don't ask before writing into a non-empty directory
  -h, --help          Show this help

${dim("Runs against the same guest flow as https://whattodoby.filheinzrelatorre.com —")}
${dim("no account needed, subject to the same guest-tier generation limits.")}
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--local") args.api = "http://localhost:3000";
    else if (a === "--api") args.api = argv[++i];
    else if (a === "--dir") args.dir = argv[++i];
    else if (a === "--platform") args.platform = argv[++i];
    else if (a === "--scope") args.scope = argv[++i];
    else if (a === "--known") args.known = argv[++i];
    else if (a === "-y" || a === "--yes") args.yes = true;
    else if (a === "-h" || a === "--help") args.help = true;
    else args._.push(a);
  }
  return args;
}

/** Mirrors lib/pipeline/slugify.ts in the main app so folder names match what the server names the zip. */
function slugify(text) {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "app";
}

class ApiSession {
  constructor(apiBase) {
    this.apiBase = apiBase;
    this.cookie = null;
  }

  captureCookie(res) {
    const raw = res.headers.get("set-cookie");
    if (!raw) return;
    const match = raw.match(new RegExp(`${GUEST_COOKIE_NAME}=[^;,\\s]+`));
    if (match) this.cookie = match[0];
  }

  async request(pathName, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers ?? {}) };
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(`${this.apiBase}${pathName}`, { ...options, headers });
    this.captureCookie(res);
    return res;
  }
}

/** Reads a JSON body and exits with the server's own error message on failure, rather than a generic HTTP error. */
async function readJsonOrDie(res, label) {
  let json = {};
  try {
    json = await res.json();
  } catch {
    // Non-JSON error body (e.g. a platform 500) — fall through to statusText below.
  }
  if (!res.ok) {
    fail(`${label} failed: ${json.error ?? res.statusText}`);
    process.exit(1);
  }
  return json;
}

async function submitPrompt(session, prompt, hints) {
  const body = Object.keys(hints).length > 0 ? { prompt, hints } : { prompt };
  const res = await session.request("/api/prompt/submit", { method: "POST", body: JSON.stringify(body) });
  return readJsonOrDie(res, "PRD generation");
}

async function pollJob(session, jobId) {
  const start = Date.now();
  const spinner = createSpinner("Queued");
  let lastMessage = "Queued";

  for (;;) {
    const res = await session.request(`/api/jobs/${jobId}/status`);
    const json = await readJsonOrDie(res, "Job status check");

    if (json.message && json.message !== lastMessage) {
      const progress = typeof json.progress === "number" ? ` (${json.progress}%)` : "";
      lastMessage = json.message;
      spinner.update(`${lastMessage}${progress}`);
    }

    if (json.state === "succeeded") {
      spinner.stop(`  ${green("✔")} ${lastMessage}`);
      return json;
    }
    if (json.state === "failed") {
      spinner.stop(`  ${red("✖")} ${json.error ?? lastMessage}`);
      return json;
    }

    if (Date.now() - start > JOB_TIMEOUT_MS) {
      spinner.stop(`  ${red("✖")} Timed out`);
      fail("Timed out waiting for boilerplate generation. Please try again.");
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

async function resolveTargetDir(requestedName, fallbackSeed, rl, autoYes) {
  const dirName = requestedName || slugify(fallbackSeed);
  const targetDir = path.resolve(process.cwd(), dirName);

  if (existsSync(targetDir)) {
    const entries = await readdir(targetDir).catch(() => []);
    if (entries.length > 0 && !autoYes) {
      const answer = await rl.question(
        `${yellow("!")} Directory "${dirName}" already exists and isn't empty. Write into it anyway? (y/N) `
      );
      if (answer.trim().toLowerCase() !== "y") {
        fail("Aborted — no files were written.");
        process.exit(1);
      }
    }
  } else {
    await mkdir(targetDir, { recursive: true });
  }
  return { targetDir, dirName };
}

/** Zip-slip guard: refuses any entry whose resolved path would land outside targetDir. */
async function extractZip(buffer, targetDir) {
  const zip = await JSZip.loadAsync(buffer);
  for (const entry of Object.values(zip.files)) {
    const destPath = path.resolve(targetDir, entry.name);
    if (destPath !== targetDir && !destPath.startsWith(targetDir + path.sep)) {
      throw new Error(`Refusing to extract entry outside target directory: ${entry.name}`);
    }
    if (entry.dir) {
      await mkdir(destPath, { recursive: true });
      continue;
    }
    await mkdir(path.dirname(destPath), { recursive: true });
    const content = await entry.async("nodebuffer");
    await writeFile(destPath, content);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  console.log(`${bold(cyan("\ncreate-whattodo"))} ${dim("— idea → PRD → stack → running project")}`);

  const rl = readline.createInterface({ input: stdin, output: stdout });
  let idea = args._.join(" ").trim();
  if (!idea) {
    idea = (await rl.question(`${bold("What do you want to build?")} `)).trim();
  }
  if (!idea) {
    fail("An idea description is required.");
    rl.close();
    process.exit(1);
  }

  const hints = {};
  if (args.platform) hints.platform = args.platform;
  if (args.scope) hints.scopeSize = args.scope;
  if (args.known) hints.stackFamiliarity = args.known;

  const session = new ApiSession(args.api || DEFAULT_API);

  step("Generating your PRD...");
  let submitJson = await submitPrompt(session, idea, hints);

  let rounds = 0;
  while (submitJson.needsClarification && rounds < MAX_CLARIFICATION_ROUNDS) {
    console.log(`\n${yellow("?")} ${submitJson.clarifyingQuestion}`);
    const answer = (await rl.question(`${cyan("> ")}`)).trim();
    idea = `${idea}\n${answer}`;
    submitJson = await submitPrompt(session, idea, hints);
    rounds += 1;
  }
  if (submitJson.needsClarification) {
    fail("Still too vague after a few tries — run again with a more specific idea.");
    rl.close();
    process.exit(1);
  }
  success("PRD ready.");

  step("Choosing a stack...");
  const stackRes = await session.request("/api/stack/generate", { method: "POST", body: JSON.stringify({}) });
  const stackJson = await readJsonOrDie(stackRes, "Stack recommendation");
  console.log(`\n  ${bold("Recommended stack")}`);
  for (const [layer, pick] of Object.entries(stackJson.stack)) {
    console.log(`  ${dim(layer.padEnd(10))} ${cyan(pick.choice)}`);
  }

  step("Generating your boilerplate (this can take a minute or two)...");
  const genRes = await session.request("/api/boilerplate/generate", { method: "POST" });
  const genJson = await readJsonOrDie(genRes, "Boilerplate generation");

  const finalStatus = await pollJob(session, genJson.jobId);
  if (finalStatus.state !== "succeeded") {
    fail(`Boilerplate generation failed: ${finalStatus.error ?? finalStatus.message}`);
    rl.close();
    process.exit(1);
  }
  if (finalStatus.unvalidated) {
    warn("The server skipped the build/syntax check for this project (no compatible interpreter available there) — review it locally before trusting it fully.");
  }

  step("Downloading your project...");
  const zipRes = await session.request("/api/boilerplate/download");
  const zipJson = zipRes.ok ? null : await zipRes.json().catch(() => ({}));
  if (!zipRes.ok) {
    fail(`Couldn't download the generated project: ${zipJson?.error ?? zipRes.statusText}`);
    rl.close();
    process.exit(1);
  }
  const zipBuffer = Buffer.from(await zipRes.arrayBuffer());

  const { targetDir, dirName } = await resolveTargetDir(args.dir, idea.split("\n")[0], rl, args.yes);
  await extractZip(zipBuffer, targetDir);

  console.log(`\n${green("✔")} ${bold(`Done — your project is ready in ./${dirName}`)}`);
  console.log(`\n${bold("Next steps:")}`);
  console.log(`  ${cyan(`cd ${dirName}`)}`);
  console.log(`  ${cyan("npm install")}`);
  console.log(`  ${dim("# see that folder's README for env vars / database setup, then:")}`);
  console.log(`  ${cyan("npm run dev")}`);

  rl.close();
}

main().catch((err) => {
  fail(`Unexpected error: ${err.message ?? err}`);
  process.exit(1);
});
