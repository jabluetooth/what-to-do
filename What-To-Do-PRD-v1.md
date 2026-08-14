# Product Requirements Document
## What To Do? — v1 (Web App)

**Status:** Draft
**Owner:** [Product owner name]
**Last updated:** August 14, 2026
**Platform:** Web (responsive desktop-first). Mobile companion planned for v2.

---

## 1. Overview

**What To Do?** is a web application that helps developers go from "I don't know what to build" to a scaffolded, previewable project in one prompt. A developer types (or generates via a random idea tool) an app concept, and the product returns a PRD, a recommended tech stack, a scaffolded boilerplate, and a live running preview — all from that single input.

The product serves two distinct moments in a developer's workflow:
1. **Decision paralysis** — "I want to build something but don't know what."
2. **Scoping friction** — "I know roughly what I want to build but don't want to spend an hour writing a PRD and picking a stack before I can see anything."

### 1.1 Vision statement
Reduce the distance between "an idea" and "a running, scoped, scaffolded project" to a single prompt.

### 1.2 Elevator pitch
Most AI dev tools help you *build* once you know what to build. What To Do? helps you *decide* — then hands you a PRD, a stack, a boilerplate, and a live preview, ready to keep building in your own editor.

---

## 2. Problem statement

Developers — especially solo devs, indie hackers, hackathon participants, and students — regularly get stuck before writing a single line of code:

- **Idea paralysis.** Too many possible projects, no forcing function to pick one.
- **Scoping overhead.** Writing a PRD and picking a stack takes real time and is often skipped entirely, leading to scope creep or abandoned projects.
- **Cold-start friction.** Getting from "decided" to "seeing something running" involves stack research, boilerplate setup, and config — often 30–60+ minutes before any real progress.
- **No fast validation loop.** There's no quick way to see what an idea *looks like* before committing hours to it.

Existing tools solve adjacent but different problems: v0/bolt.new/Lovable generate UI from a prompt but assume you already know what you're building and typically skip PRD/scoping entirely. Project management tools help *after* scoping, not before. Boilerplate generators (create-react-app, etc.) assume the stack is already decided.

**Gap:** nothing takes a developer from "no idea" or "vague idea" all the way through scoping, stack selection, scaffolding, and a live preview in one continuous flow.

---

## 3. Goals and non-goals (v1)

### 3.1 Goals
- Let a developer go from a single prompt to a PRD, tech stack recommendation, boilerplate, and live preview.
- Provide a random idea generator for developers with no starting idea.
- Support both a no-signup sandbox mode and a signed-in mode with persistent history.
- Ship as a responsive web app, desktop-first (primary usage context is a laptop/desktop browser).
- Keep the boilerplate output usable — developers should be able to download it or push it to GitHub and continue in their own editor.

### 3.2 Non-goals (explicitly out of scope for v1)
- Native mobile app (planned for v2, browsing/idea-generation use case only).
- Full in-browser IDE / continued in-app development after boilerplate generation.
- Team collaboration features beyond basic sharing (e.g. real-time multiplayer editing).
- Support for non-JS/TS backend stacks in the live preview (Python, Ruby, mobile-native previews) — v1 preview is scoped to WebContainer-compatible stacks.
- Monetization/billing infrastructure (v1 may be free or waitlisted; pricing model is a separate workstream).
- Deep IDE plugin integrations (VS Code extension, JetBrains plugin).

---

## 4. Target users

| Persona | Description | Primary need |
|---|---|---|
| **Indie hacker / solo builder** | Wants to validate and start side projects quickly | Fast idea → scoped MVP → running code |
| **Hackathon participant** | Has hours, not days, to decide and start | Speed above all; stack should match what they already know |
| **Student / bootcamp grad** | Building portfolio projects | Guided PRD writing, sensible stack defaults, learning-friendly boilerplate |
| **Freelancer** | Needs to scope client work fast | Clean PRD output they can show a client, believable estimates |

All four personas are developers with at least basic familiarity with running a scaffolded project locally (npm install, etc.) — v1 does not target non-technical users.

**Note:** the Hackathon persona's "stack should match what they already know" need is served primarily through the prompt's optional stack-familiarity hint (6.1) when used as a guest, since full history-based stack personalization (6.3) requires a signed-in account and this persona is the most likely to skip sign-up.

---

## 5. User flows

### 5.1 Guest (sandbox) flow
1. User lands on the app, no sign-in required.
2. User enters a prompt directly, or clicks "Generate a random idea" first and then accepts one into the prompt field.
3. Pipeline runs: PRD → tech stack → boilerplate → live preview, with progress shown per stage.
4. User can edit any completed stage (e.g. adjust the PRD) and re-run downstream stages.
5. User can download the boilerplate as a zip at any point after it's generated.
6. Session persists only for the browser tab. On tab close, explicit exit, or after 30–60 minutes of inactivity, all sandbox data is deleted server-side.
7. At key moments — the inactivity-timeout warning, explicit exit, or download/export — the user is prompted: "Sign up to save this project" — accepting migrates the sandbox data to a new account instead of deleting it. (Tab close is a best-effort deletion trigger only; it cannot show a prompt, so it never blocks on user response — see 10, guest deletion edge cases.)

### 5.2 Signed-in flow
1. User signs in (or converts from a guest session).
2. Same core pipeline as guest, but every project is saved with full version history per stage.
3. User has a dashboard of past projects, can resume any in-progress project, and can revisit completed ones. From any project's history entry, the user can download the PRD, download the boilerplate zip, or hit a preview button to relaunch that project's sandboxed live preview on demand.
4. User gets personalized feature recommendations based on history (see 6.6).
5. User can push boilerplate directly to a new GitHub repo via OAuth (in addition to zip download).
6. User receives a notification when boilerplate generation (a server-side async job) completes, so they don't have to wait on-screen. Preview does not get a separate away-from-tab notification: it's a client-side WebContainer session the user boots on demand by clicking Preview (see 6.5), so it only ever runs while the tab is open.

### 5.3 Random idea generator flow (entry point, either guest or signed-in)
1. User clicks "Generate an idea" under the "Stuck on thinking what to do?" prompt, without typing anything.
2. System returns a short idea card: title + one-line description + platform tag.
3. User chooses "Randomize again" (get another idea, repeatable) or "Use this idea" (feeds it into the main prompt as if the user had typed it).
4. From there the user can edit the populated prompt or submit as-is to start the full pipeline.
5. Signed-in users can favorite/star ideas without committing to the full pipeline.

See 6.1.1 for the full UI/interaction spec.

---

## 6. Functional requirements

### 6.1 Prompt input
- Single free-text input, developer describes an app idea in natural language.
- Optional structured hints: platform (web/mobile — v1 recommends web-only builds but PRD/stack output may still reference mobile constraints if the user specifies "mobile app"), rough scope size (weekend project / MVP / production app), and familiar stack/technologies (free text, e.g. "I know React and Postgres") — used to bias the tech stack recommendation for guests and first-time signed-in users who have no history for 6.3 to draw on.
- Input validation: minimum prompt length/detail; if too vague, the system asks one clarifying question rather than generating a low-quality PRD from nothing. If the follow-up answer is still insufficient, the system proceeds with best-effort generation rather than looping indefinitely, and visibly flags the PRD as low-confidence/needs-review.

### 6.1.1 "Stuck on thinking what to do?" entry point
A secondary, always-visible entry point next to the prompt input for users with no idea at all.

- **UI copy:** headline "Stuck on thinking what to do?" with a single button labeled "Generate an idea."
- **Interaction:**
  1. User clicks "Generate an idea" with the prompt field still empty.
  2. System returns one random app idea as a short card: title + one-line description + platform tag (web/mobile).
  3. User is shown two actions: **"Use this idea"** and **"Randomize again."**
  4. "Randomize again" replaces the card with a new random idea, up to the per-session daily generation cap (see §7, Cost control) — revised from the original "no cap in v1" call once real usage costs were being observed live during build.
  5. "Use this idea" populates the idea's title and description into the prompt input as if the user had typed it, and the user can edit it before submitting, or submit as-is to start the full pipeline immediately.
- **Repetition handling:** the generator should avoid showing the same idea twice in a row within a session, and avoid near-duplicate ideas across a short regeneration streak (e.g. don't return three "recipe app" variants back to back).
- **No commitment required:** clicking "Generate an idea" or "Randomize again" never starts the pipeline or creates a project by itself — only "Use this idea" (or manual submission after editing) does.
- **Signed-in extra:** a small star/favorite icon on the idea card lets signed-in users save an idea without using it immediately (see 6.6, Favorites).

### 6.2 PRD generation
- Output includes: problem statement, target user, core feature list (MVP-scoped), user stories, out-of-scope items, rough complexity/time estimate.
- Editable after generation — user can revise any section inline.
- Editing the PRD flags downstream stages (stack, boilerplate) as stale and offers to regenerate them.

### 6.3 Tech stack recommendation
- Recommends frontend, backend, database, hosting, and auth choices with a short rationale for each (not just a list).
- Takes signed-in user's stack history/preferences into account when available (e.g. "you've used Next.js + Supabase in your last 3 projects"); for guests and first-time signed-in users with no history, falls back to the prompt's optional stack-familiarity hint (6.1) when provided.
- User can override any recommended piece before boilerplate generation (e.g. swap Supabase for a plain Postgres setup). Overriding the stack flags the boilerplate as stale and offers to regenerate it, mirroring the PRD-edit behavior in 6.2.

### 6.4 Boilerplate generation
- Built from a curated, versioned template library per stack combination, with LLM-generated fill-in for app-specific pieces (routes, models, initial UI) rather than generating an entire project from scratch.
- Output is a real, runnable project structure — valid package.json/config, no placeholder-only stubs in critical paths.
- Delivery: downloadable zip (all users) and push-to-new-GitHub-repo (signed-in users via OAuth).

### 6.5 Live preview
- v1 preview scope: JS/TS web stacks only, run via in-browser WebContainer technology (no server compute cost per preview).
- Preview reflects the actual generated boilerplate — not a mockup.
- Preview has an idle timeout of ~10 minutes of tab inactivity to control resource usage. This is a separate, shorter clock than the overall guest session inactivity timeout (5.1.6): reaching it stops the running WebContainer only, it does not delete the underlying sandbox/session data.
- For signed-in users, a preview is not kept running indefinitely after generation — it's relaunched on demand from the saved boilerplate via the history dashboard's Preview button (see 6.6), with a brief rehydration load state.
- Non-WebContainer-compatible stacks (e.g. Python backends) get a static file-tree view instead of a running preview in v1, with a note that live preview isn't yet supported for that stack.

### 6.6 Signed-in feature set
- **Project history dashboard** — list of past and in-progress projects, each showing current stage and last-updated time. Each project row/card includes:
  - **Download PRD** — export the PRD as a standalone file (e.g. Markdown/PDF) independent of the other stages.
  - **Download boilerplate** — re-download the generated project as a zip at any time, not just right after generation.
  - **Preview button** — relaunches the sandboxed live preview for that project on demand, re-spinning the WebContainer session from the saved boilerplate rather than keeping a preview running indefinitely (see 7, cost control). A short load state is expected while the sandbox rehydrates.
  - Stack summary and quick access to re-open the full project view (PRD, stack, boilerplate, preview together).
- **Version history** — each stage (PRD, stack, boilerplate) retains prior versions. Users can view a read-only diff against a previous version and restore one as the active version; restoring re-flags downstream stages as stale using the same rule as a fresh edit (6.2, 6.3).
- **Resume flow** — continue an unfinished project from wherever it left off.
- **Personalized recommendations** — surfaced on the dashboard and after idea generation, based on the user's stack history and completed project categories (e.g. "you've built 3 e-commerce ideas — try a marketplace next"). Project category is inferred automatically from PRD content at generation time, not manually tagged.
- **Favorites** — star ideas from the random generator without starting the full pipeline.
- **Async notifications** — email or in-app notification when a long-running job completes.
- **Basic sharing** — generate a shareable read-only link to a PRD/stack for feedback (no real-time collaborative editing in v1).

### 6.7 Guest sandbox
- No account required to run the full pipeline. A guest may start a new sandbox session and run the pipeline multiple times within that session, subject to the per-session generation caps in §7 — v1 does not impose a separate one-run-ever restriction tied to device/IP.
- All sandbox data is ephemeral: deleted on explicit exit, tab close (best effort), or inactivity timeout.
- Clear, persistent UI messaging that guest work is not saved, with a visible "Sign up to save" call to action.
- Conversion flow migrates the existing sandbox session's data into the new account rather than requiring the user to start over.

---

## 7. Non-functional requirements

- **Performance:** PRD generation should complete in under ~10 seconds; boilerplate + preview generation is expected to take longer (up to ~60s) and must run asynchronously with visible progress, not block the UI.
- **Reliability:** Each pipeline stage should be independently retryable without forcing a full pipeline restart, with a visible failure state in the UI (what failed, why if known, and a retry action) rather than a silent stall.
- **Security:** Guest sandbox sessions must be isolated from one another (no cross-session data leakage); GitHub OAuth tokens stored securely and scoped minimally (repo-create only, not full account access).
- **Abuse prevention:** Prompts and generated ideas pass through basic content moderation before reaching the LLM pipeline (block clearly malicious asks — phishing kits, credential harvesters, spam/scraper tooling). Every generation stage is rate-limited per guest session, not only preview generation.
- **Cost control:** Preview environments must have hard timeouts and idle shutdown (see 6.5). Every generation stage is capped per session/day, tiered by account status — v1 initial numbers: guest — 5 PRD, 5 random ideas, 10 stack, **1 boilerplate**; signed-in — 10 PRD, 10 random ideas, 10 stack, 5 boilerplate. Boilerplate is capped tightest for guests specifically: it's the most expensive stage (LLM code generation plus a real install+build check) and the one most likely to fail outright if attempted without headroom on the primary model (see the fail-fast requirement below). These are tunable v1 defaults, not final pricing-tier numbers (see §10).
- **LLM provider degradation:** if the primary (quality-tier) model is rate-limited, PRD/stack/idea generation transparently retries on a secondary model rather than failing outright — a lower-quality result beats a hard failure for those stages. Boilerplate generation is the deliberate exception: because generated code either compiles or it doesn't, attempting it on a known-unreliable secondary model mostly just wastes a full install+build cycle, so it must fail fast with a clear "try again shortly" message instead of attempting.
- **Data retention:** Guest sandbox data has a hard deletion policy (see 6.7); signed-in user data retention follows standard account-deletion practices (delete on request).
- **Accessibility:** Core flows (prompt input, PRD review, dashboard) meet WCAG 2.2 AA as a baseline. This applies to What To Do?'s own UI chrome; the arbitrary LLM-generated application code rendered inside the live preview is explicitly out of scope for this conformance target.

---

## 8. Technical architecture (summary)

*(See architecture diagram from prior discussion for full detail.)*

- **Orchestrator:** job-based, async pipeline coordinator; each stage (PRD, stack, boilerplate, preview) is an independently retryable job whose output feeds the next stage's input.
- **Preview:** WebContainer-based in-browser execution for JS/TS stacks in v1; no server-side compute cost per preview.
- **Boilerplate:** template library (versioned, per stack) + LLM-generated app-specific fill-in, not pure from-scratch generation.
- **Storage:** Postgres for users/projects/versioned stage data; object storage for generated file trees; separate guest-session store with TTL-based purge job.
- **Idea generator:** lightweight/fast model, optionally grounded against a curated seed list to avoid repetition.

---

## 9. Success metrics (v1)

- **Activation:** % of visitors who complete at least one full pipeline run (prompt → preview) in a session.
- **Guest-to-signup conversion rate** at the sandbox-deletion/export prompt.
- **Time to first preview** (prompt submitted → preview visible), target under 90 seconds end-to-end, measured on the straight-through path (no manual stage edits). Sessions where the user edits a completed stage before proceeding are excluded from this metric.
- **Boilerplate usability rate** — proxy metric: % of generated boilerplates downloaded or pushed to GitHub (signals the developer judged it good enough to keep).
- **Return usage (signed-in only):** % of signed-in users who start a second project within 30 days.

---

## 10. Risks and open questions

| Risk / question | Notes |
|---|---|
| Preview compute cost at scale | Even with WebContainers offloading JS/TS execution to the client, non-WebContainer stacks or heavy usage could still require server-side sandboxing later. Needs a cost model before scaling guest access. |
| Boilerplate reliability | LLM-generated fill-in on top of templates still carries hallucination risk (bad imports, mismatched versions). Needs automated validation (e.g. install + build check) before showing the preview. |
| Guest deletion edge cases | Browser crashes, force-quits, and network drops mean "delete on exit" can't be 100% reliable — the inactivity-timeout backstop is required, not optional. |
| Scope of "tech stack recommendation" | Is it purely LLM reasoning, or backed by a curated decision matrix with LLM-written rationale? Curated matrix is safer/more consistent — recommend confirming before backend build starts. |
| Naming/trademark/domain check | "What To Do?" name and domain availability not yet verified — needs legal/brand check before public launch. |
| Pricing model | Not yet defined as an actual monetization plan, but the underlying usage caps are no longer TBD — see §7 for v1's concrete guest/signed-in generation caps. Actual pricing tiers may revise these numbers later without changing the mechanism. |
| WebContainer vendor dependency | v1's "no server compute cost" preview architecture depends entirely on StackBlitz's WebContainers, which carries commercial/usage-based licensing terms for production use outside StackBlitz's own products. Licensing terms and cost at expected scale need confirming before committing to this as the sole v1 preview mechanism. |
| Abuse / malicious generation | No-signup guest access plus real, runnable, GitHub-pushable code output is a vector for generating malicious tooling (phishing kits, scrapers, spam bots). Needs basic prompt/content moderation before public launch, not just usage-cost caps (see §7). |

---

## 11. Roadmap

**v1 (this document):** Web app. Prompt → PRD → stack → boilerplate → preview pipeline. Guest sandbox + signed-in history. Random idea generator. GitHub push for signed-in users.

**v2 (future):** Mobile companion app scoped to idea browsing/generation and favoriting only (no PRD/stack/preview pipeline on mobile). Expanded stack support for live preview beyond WebContainer-compatible stacks. Team collaboration features.

---

## 12. Appendix

- **Working name:** What To Do?
- **Platform decision:** Web app for v1. Rationale: primary interactions (detailed prompt input, PRD review, file-tree/boilerplate review, live code preview) require keyboard input and screen real estate; WebContainer preview technology is inherently browser-based; GitHub OAuth and repo-push flows are desktop-native workflows; target personas are already at a laptop/desktop when in "what should I build" mode.
