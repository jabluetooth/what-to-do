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
 * nothing reactive — keeps it out of boot()'s dependency chain.
 */
function reportValidation(verified: boolean) {
  fetch("/api/preview/report-validation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verified }),
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

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    void boot();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      void teardownWebContainer();
    };
  }, []);

  async function boot() {
    setState({ phase: "loading" });
    try {
      const res = await fetch("/api/preview/bootstrap");
      const data = await res.json();

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

      await instance.mount(data.tree);

      setState({ phase: "installing" });
      const install = await instance.spawn("npm", ["install"]);
      const installCode = await install.exit;
      if (installCode !== 0) {
        setState({ phase: "build-error", log: "npm install failed inside the preview environment." });
        reportValidation(false);
        return;
      }

      setState({ phase: "starting" });
      const dev = await instance.spawn("npm", ["run", "dev"]);
      void dev.exit;

      instance.on("server-ready", (_port, url) => {
        setState({ phase: "ready", url });
        reportValidation(true);
        idleTimerRef.current = setTimeout(() => {
          void teardownWebContainer();
          setState({ phase: "timedout" });
        }, IDLE_TIMEOUT_MS);
      });
    } catch (err) {
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
          <div className="flex h-full items-center justify-center px-6">
            <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
          </div>
        )}

        {state.phase === "build-error" && (
          <div className="h-full overflow-auto p-4">
            <p className="text-sm text-red-600 dark:text-red-400 mb-2">Preview failed to start.</p>
            <pre className="text-xs whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{state.log}</pre>
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
