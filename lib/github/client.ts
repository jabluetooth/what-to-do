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
    public status: number
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

async function githubRequest<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: { ...authHeaders(accessToken), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GithubApiError(`GitHub API ${init?.method ?? "GET"} ${path} failed (${res.status}): ${body}`, res.status);
  }
  return res.json() as Promise<T>;
}

export interface CreatedRepo {
  owner: string;
  name: string;
  htmlUrl: string;
}

/**
 * Retries once with a short random suffix on a name collision (422) — the base name is derived
 * from the user's prompt (see pushBoilerplate.ts), which two different projects can plausibly
 * share, and repo names must be unique within an account.
 */
export async function createRepo(accessToken: string, name: string, description: string): Promise<CreatedRepo> {
  const attempt = async (repoName: string) =>
    githubRequest<{ owner: { login: string }; name: string; html_url: string }>(accessToken, "/user/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: repoName,
        description: description.slice(0, 350),
        private: true,
        auto_init: false,
      }),
    });

  try {
    const repo = await attempt(name);
    return { owner: repo.owner.login, name: repo.name, htmlUrl: repo.html_url };
  } catch (err) {
    if (err instanceof GithubApiError && err.status === 422) {
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
