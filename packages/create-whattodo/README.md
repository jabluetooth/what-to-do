# create-whattodo

Scaffold a real, boot-tested project from a one-sentence idea — the [What To Do](https://whattodoby.filheinzrelatorre.com) pipeline (idea → PRD → stack recommendation → generated boilerplate), run from your terminal instead of a browser.

## Usage

```bash
npx create-whattodo "a tool that tracks my reading list and nudges me to finish books"
```

Or run it with no argument and it'll ask:

```bash
npx create-whattodo
```

If the idea is too vague to scope, it asks a clarifying question before generating anything — same as the website.

## Options

| Flag | Description |
|---|---|
| `--dir <name>` | Target directory name (default: derived from your idea) |
| `--platform <kind>` | `web` or `mobile` |
| `--scope <size>` | `weekend`, `mvp`, or `production` |
| `--known <stacks>` | Stacks you already know, e.g. `"React, Postgres"` |
| `--local` | Point at `http://localhost:3000` instead of the live API (for testing against a local dev server) |
| `--api <url>` | Point at a custom API base URL |
| `-y`, `--yes` | Don't ask before writing into a non-empty directory |

## How it works

This CLI has no logic of its own beyond orchestration — it drives the same guest-mode API the website uses:

1. `POST /api/prompt/submit` — idea → PRD (no account needed)
2. `POST /api/stack/generate` — PRD → recommended stack
3. `POST /api/boilerplate/generate` — queues an async job that scaffolds and boot-tests the project
4. `GET /api/jobs/:id/status` — polled until the job finishes
5. `GET /api/boilerplate/download` — the finished project as a zip, extracted into your target directory

All requests carry the same short-lived guest-session cookie the browser would set, so a CLI run counts against the same guest-tier generation limits as a browser session — there's no separate or elevated quota for the CLI.

## Publishing

```bash
cd packages/create-whattodo
npm publish
```

Requires npm auth for the `create-whattodo` package name (unclaimed as of writing — first publish will register it).
