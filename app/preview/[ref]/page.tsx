"use client";

import { useEffect, useRef, useState } from "react";
import { getWebContainer, teardownWebContainer } from "@/lib/webcontainer/singleton";

interface FlatFile {
  path: string;
  content: string;
}

type PreviewState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "fallback"; files: FlatFile[] }
  | { phase: "booting" }
  | { phase: "installing" }
  | { phase: "starting" }
  | { phase: "ready"; url: string }
  | { phase: "build-error"; log: string }
  | { phase: "timedout" };

/** PRD §6.5: preview has a reasonable idle timeout to control resource usage. */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The server no longer attempts a real install+build itself (see lib/sandbox/validateSyntax.ts)
 * — this WebContainer boot is now the only place that actually happens, so its outcome is worth
 * persisting server-side via boilerplateBuildVerified rather than only ever being visible in
 * this one tab. Only called for genuine code-validity signals (a real install failure, or the
 * dev server actually starting) — not for infra-level issues (bootstrap fetch failing, the
 * WebContainer itself throwing on mount), since those aren't evidence about the *generated
 * code* one way or the other. Module-level, not a component function, since it closes over
 * nothing reactive — keeps it out of boot()'s dependency chain. Takes the prefix bootstrap
 * returned (not re-derived) so the server can reject a report about a since-superseded
 * generation instead of misattributing it to whatever the session's current boilerplate is.
 */
function reportValidation(prefix: string, verified: boolean) {
  fetch("/api/preview/report-validation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, verified }),
  }).catch(() => {
    // best effort — this is a secondary record of what the user can already see in this tab
  });
}

export default function PreviewPage() {
  const [state, setState] = useState<PreviewState>({ phase: "loading" });
  const [selectedFile, setSelectedFile] = useState<FlatFile | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards the effect's automatic initial boot against React StrictMode's dev-mode double
  // invocation — confirmed live that without this, mount()+spawn(npm install/dev) both ran
  // twice, racing two dev-server processes for the same port. Doesn't affect "Relaunch
  // preview", which calls boot() directly on a real user click, not through this effect.
  const didInitRef = useRef(false);
  // Set true in the effect's cleanup so in-flight async work (a pending fetch, an awaited
  // WebContainer call) can tell "navigated away mid-boot" apart from "still mounted" — without
  // this, work that resolves after unmount could still setState/reportValidation/schedule the
  // idle timer against an already-torn-down container. Confirmed as a real bug: the orphaned
  // setTimeout in particular could later fire and call teardownWebContainer() on a *different*,
  // unrelated preview session started after this one's cleanup already ran.
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    void boot();
    return () => {
      cancelledRef.current = true;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      void teardownWebContainer();
    };
  }, []);

  async function boot() {
    cancelledRef.current = false;
    setState({ phase: "loading" });
    try {
      const res = await fetch("/api/preview/bootstrap");
      const data = await res.json();
      if (cancelledRef.current) return;

      if (!res.ok) {
        setState({ phase: "error", message: data.error ?? "Couldn't load the preview." });
        return;
      }

      if (!data.compatible) {
        setState({ phase: "fallback", files: data.files });
        return;
      }

      setState({ phase: "booting" });
      const instance = await getWebContainer();
      if (cancelledRef.current) return;

      await instance.mount(data.tree);
      if (cancelledRef.current) return;

      setState({ phase: "installing" });
      const install = await instance.spawn("npm", ["install"]);
      const installCode = await install.exit;
      if (cancelledRef.current) return;
      if (installCode !== 0) {
        setState({ phase: "build-error", log: "npm install failed inside the preview environment." });
        reportValidation(data.prefix, false);
        return;
      }

      setState({ phase: "starting" });
      // The template is pinned to Next.js 15.x (see templates/nextjs-postgres-drizzle/package.json),
      // where webpack is already the default dev bundler — Turbopack there is opt-in via
      // --turbopack, the reverse of 16.x where it's the default and needs --webpack to opt out.
      // Passing --webpack here against 15.x hung the dev server entirely (confirmed live: stuck
      // at "Starting dev server..." indefinitely, no server-ready event, no errors) — almost
      // certainly an unrecognized flag. Plain `npm run dev` is correct for the pinned version.
      const dev = await instance.spawn("npm", ["run", "dev"]);
      void dev.exit;

      instance.on("server-ready", (_port, url) => {
        if (cancelledRef.current) return;
        // "server-ready" only means the dev server *process* started — Next.js compiles routes
        // on demand, so a syntax/import error in app/page.tsx wouldn't surface until something
        // actually requests "/", which previously happened only once the iframe below loaded
        // (after verified:true had already been reported). Confirmed live: a job that passed
        // the server-side syntax check (which can't catch import/module errors, only parse
        // errors) still failed to compile once actually requested. Fetching the root route here
        // first makes the report reflect what a real request finds, not just "the process
        // launched." The iframe still renders either way — a failed check doesn't hide it, since
        // Next's own dev error overlay in that iframe is the most useful thing the user can see.
        void (async () => {
          let verified = true;
          try {
            const check = await fetch(url);
            verified = check.ok;
          } catch {
            // Inconclusive (proxy/network hiccup, not necessarily a real compile failure) —
            // don't downgrade the report on this alone; the iframe is the real source of truth.
          }
          if (cancelledRef.current) return;
          setState({ phase: "ready", url });
          reportValidation(data.prefix, verified);
          if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
          idleTimerRef.current = setTimeout(() => {
            void teardownWebContainer();
            setState({ phase: "timedout" });
          }, IDLE_TIMEOUT_MS);
        })();
      });
    } catch (err) {
      if (cancelledRef.current) return;
      setState({ phase: "error", message: err instanceof Error ? err.message : "Preview failed to start." });
    }
  }

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-4 py-2">
        <span className="text-sm font-medium">Live Preview</span>
        {state.phase === "ready" && (
          <span className="text-xs text-green-700 dark:text-green-400">Running</span>
        )}
      </header>

      <div className="flex-1 overflow-hidden">
        {(state.phase === "loading" ||
          state.phase === "booting" ||
          state.phase === "installing" ||
          state.phase === "starting") && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-neutral-600 dark:text-neutral-400" role="status" aria-live="polite">
              {state.phase === "loading" && "Loading your project..."}
              {state.phase === "booting" && "Booting preview environment..."}
              {state.phase === "installing" && "Installing dependencies..."}
              {state.phase === "starting" && "Starting dev server..."}
            </p>
          </div>
        )}

        {state.phase === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {state.message}
            </p>
            <button
              type="button"
              onClick={boot}
              className="rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-medium"
            >
              Try again
            </button>
          </div>
        )}

        {state.phase === "build-error" && (
          <div className="h-full overflow-auto p-4">
            <p className="text-sm text-red-600 dark:text-red-400 mb-2" role="alert">
              Preview failed to start.
            </p>
            <pre className="text-xs whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{state.log}</pre>
            <button
              type="button"
              onClick={boot}
              className="mt-3 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-medium"
            >
              Try again
            </button>
          </div>
        )}

        {state.phase === "timedout" && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Preview stopped after 10 minutes idle.
            </p>
            <button
              type="button"
              onClick={boot}
              className="rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-medium"
            >
              Relaunch preview
            </button>
          </div>
        )}

        {state.phase === "ready" && (
          <iframe src={state.url} title="Live preview" className="h-full w-full border-0" />
        )}

        {state.phase === "fallback" && (
          <div className="flex h-full">
            <nav className="w-64 shrink-0 overflow-auto border-r border-neutral-200 dark:border-neutral-800 p-2">
              <p className="mb-2 px-2 text-xs text-neutral-500">
                Live preview isn&apos;t supported for this stack yet — showing the generated files.
              </p>
              <ul>
                {state.files.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => setSelectedFile(f)}
                      className={`w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900 ${
                        selectedFile?.path === f.path ? "bg-neutral-100 dark:bg-neutral-900 font-medium" : ""
                      }`}
                    >
                      {f.path}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="flex-1 overflow-auto p-4">
              {selectedFile ? (
                <pre className="text-xs whitespace-pre-wrap">{selectedFile.content}</pre>
              ) : (
                <p className="text-sm text-neutral-500">Select a file to view its contents.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
