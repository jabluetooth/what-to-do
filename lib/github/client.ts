import { z } from "zod";

const GITHUB_API = "https://api.github.com";

interface PushableFile {
  path: string;
  content: string;
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export class GithubApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Raw response body text — kept so callers needing to distinguish *why* a 422 happened (e.g. createRepo's name-collision check) don't have to re-fetch or guess from the message string alone. */
    public body: string
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

/** Raw response, not yet validated — callers that read fields off it must parse it against a schema first (see createRepo). */
async function githubRequest(accessToken: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: { ...authHeaders(accessToken), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GithubApiError(`GitHub API ${init?.method ?? "GET"} ${path} failed (${res.status}): ${body}`, res.status, body);
  }
  return res.json();
}

export interface CreatedRepo {
  owner: string;
  name: string;
  htmlUrl: string;
}

/** Only the fields actually read from GitHub's repo response — validated rather than cast, same as every other external/untrusted response in this codebase (see lib/llm/callTool.ts). */
const RepoResponseSchema = z.object({
  owner: z.object({ login: z.string() }),
  name: z.string(),
  html_url: z.string(),
});

/** GitHub's actual response text for this specific case — a generic "422" can also mean an org policy block or a repo-creation-quota error, which retrying wouldn't fix and would just obscure. */
function isNameCollision(err: GithubApiError): boolean {
  return err.status === 422 && err.body.toLowerCase().includes("name already exists on this account");
}

/**
 * Retries once with a short random suffix on a name collision (422) — the base name is derived
 * from the user's prompt (see pushBoilerplate.ts), which two different projects can plausibly
 * share, and repo names must be unique within an account.
 */
export async function createRepo(accessToken: string, name: string, description: string): Promise<CreatedRepo> {
  const attempt = async (repoName: string) => {
    const raw = await githubRequest(accessToken, "/user/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: repoName,
        description: description.slice(0, 350),
        private: true,
        auto_init: false,
      }),
    });
    return RepoResponseSchema.parse(raw);
  };

  try {
    const repo = await attempt(name);
    return { owner: repo.owner.login, name: repo.name, htmlUrl: repo.html_url };
  } catch (err) {
    if (err instanceof GithubApiError && isNameCollision(err)) {
      const repo = await attempt(`${name}-${Math.random().toString(36).slice(2, 7)}`);
      return { owner: repo.owner.login, name: repo.name, htmlUrl: repo.html_url };
    }
    throw err;
  }
}

/**
 * One commit per file via the Contents API — simple and reliable for a handful of files (a
 * generated boilerplate is ~8-10 files, "one representative slice" per template.ts). The Git
 * Data API (blobs/tree/commit in one call) would be more efficient for a larger file set, but
 * isn't worth the added complexity at this scale.
 */
export async function pushFiles(accessToken: string, owner: string, repo: string, files: PushableFile[]): Promise<void> {
  for (const file of files) {
    const encodedPath = file.path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    await githubRequest(accessToken, `/repos/${owner}/${repo}/contents/${encodedPath}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Add ${file.path}`,
        content: Buffer.from(file.content, "utf8").toString("base64"),
      }),
    });
  }
}
