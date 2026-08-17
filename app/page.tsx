"use client";

import { useEffect, useId, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import type { PlatformHint, PrdSection, RandomIdea, ScopeSizeHint, StackCategory, StackRecommendation } from "@/lib/types";
import { STACK_ALTERNATIVES } from "@/lib/pipeline/stackMatrix";

const SESSION_POLL_INTERVAL_MS = 30_000;
const TIMEOUT_WARNING_THRESHOLD_SECONDS = 5 * 60;

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

type FlowState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "clarifying"; question: string; submitting: boolean }
  | { phase: "result"; sections: PrdSection[]; lowConfidence: boolean }
  | {
      phase: "converted";
      projectId: string;
      prompt: string;
      sections: PrdSection[];
      lowConfidence: boolean;
      stack: StackRecommendation | null;
      hasBoilerplate: boolean;
    }
  | { phase: "error"; message: string };

const STACK_CATEGORIES: { key: StackCategory; label: string }[] = [
  { key: "frontend", label: "Frontend" },
  { key: "backend", label: "Backend" },
  { key: "database", label: "Database" },
  { key: "hosting", label: "Hosting" },
  { key: "auth", label: "Auth" },
];

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [platform, setPlatform] = useState<PlatformHint | "">("");
  const [scopeSize, setScopeSize] = useState<ScopeSizeHint | "">("");
  const [stackFamiliarity, setStackFamiliarity] = useState("");
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<FlowState>({ phase: "idle" });

  const [idea, setIdea] = useState<RandomIdea | null>(null);
  const [ideaLoading, setIdeaLoading] = useState(false);
  const [ideaError, setIdeaError] = useState<string | null>(null);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [sectionBusyKey, setSectionBusyKey] = useState<string | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);

  const [stack, setStack] = useState<StackRecommendation | null>(null);
  const [stackStale, setStackStale] = useState(false);
  const [stackLoading, setStackLoading] = useState(false);
  const [stackError, setStackError] = useState<string | null>(null);
  const [overridingCategory, setOverridingCategory] = useState<StackCategory | null>(null);
  const [overrideChoice, setOverrideChoice] = useState("");

  const [boilerplateJobId, setBoilerplateJobId] = useState<string | null>(null);
  const [boilerplateJobState, setBoilerplateJobState] = useState<
    "idle" | "pending" | "running" | "succeeded" | "failed"
  >("idle");
  const [boilerplateProgress, setBoilerplateProgress] = useState(0);
  const [boilerplateMessage, setBoilerplateMessage] = useState("");
  const [boilerplateError, setBoilerplateError] = useState<string | null>(null);
  const [boilerplateStale, setBoilerplateStale] = useState(false);
  // Whether this boilerplate can run in the in-browser live preview — false for non-JS/TS
  // stacks (e.g. FastAPI), which only get a downloadable zip. null until a job succeeds.
  const [boilerplateWebContainerCompatible, setBoilerplateWebContainerCompatible] = useState<boolean | null>(null);
  // True only when a build/syntax check was skipped entirely (no Python interpreter found for
  // the FastAPI path) — distinct from webContainerCompatible, which is about live preview, not
  // whether validation actually ran.
  const [boilerplateUnvalidated, setBoilerplateUnvalidated] = useState(false);
  // Upgrades the "syntax-checked" message to "verified" once /preview/[ref] reports back a real
  // install+build success (see the session poll below) — client-reported, display-only, see
  // lib/types.ts's boilerplateBuildVerified doc comment.
  const [boilerplateBuildVerified, setBoilerplateBuildVerified] = useState(false);

  const [sessionTtlSeconds, setSessionTtlSeconds] = useState<number | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  // Set right before signIn()'s full-page navigation so the pagehide handler below can tell
  // "leaving to sign in" apart from "actually closing the tab" — purging the guest session on
  // the way to GitHub would delete the exact data /api/account/convert needs on the way back.
  const signingInRef = useRef(false);
  const [exiting, setExiting] = useState(false);
  const [keepingWorking, setKeepingWorking] = useState(false);

  const promptId = useId();
  const platformId = useId();
  const scopeId = useId();
  const stackId = useId();
  const answerId = useId();
  const sectionEditId = useId();
  const stackOverrideId = useId();

  const hints = () => ({
    platform: platform || undefined,
    scopeSize: scopeSize || undefined,
    stackFamiliarity: stackFamiliarity.trim() || undefined,
  });

  const hasProject = state.phase === "result";
  // Converting to an account while a boilerplate job is still running deletes the guest session
  // out from under it: the job later finishes and recreates that session key with the boilerplate
  // in it, but the project it belonged to is already converted — an orphan nothing ever picks
  // up. Disabling sign-up during this window is cheaper and more honest than trying to reconcile
  // a race after the fact.
  const boilerplateJobActive = boilerplateJobState === "pending" || boilerplateJobState === "running";

  // Polls the session's remaining inactivity-timeout TTL to drive the warning banner —
  // only once a project actually exists, so an idle visitor with nothing to lose isn't polled.
  useEffect(() => {
    if (!hasProject) return;

    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/guest/session");
        const data = await res.json();
        if (!cancelled && res.ok) {
          setSessionTtlSeconds(data.ttlSeconds);
          setBoilerplateBuildVerified(Boolean(data.boilerplateBuildVerified));
        }
      } catch {
        // transient — the next scheduled poll will retry
      }
    }

    poll();
    const interval = setInterval(poll, SESSION_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hasProject]);

  // Best-effort purge on tab close (PRD §5.1.6/§10): can't show a confirmation prompt here,
  // and isn't guaranteed to run (crashes, force-quits) — the R2 lifecycle rule and Redis TTL
  // are the real backstop. sendBeacon fires the request without blocking the page unload.
  useEffect(() => {
    if (!hasProject) return;

    function handlePageHide() {
      if (signingInRef.current) return;
      navigator.sendBeacon("/api/guest/exit");
    }

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [hasProject]);

  // Runs once on mount to catch the "just came back from GitHub OAuth" case: signIn() does a
  // full-page redirect, so any in-progress guest work only survives server-side (Redis/R2) —
  // this is what actually converts it into a saved project once the user is signed in.
  useEffect(() => {
    let cancelled = false;

    async function checkAndConvert() {
      try {
        const sessionRes = await fetch("/api/auth/session");
        const sessionData = await sessionRes.json();
        if (cancelled || !sessionData?.user) return;

        const convertRes = await fetch("/api/account/convert", { method: "POST" });
        const convertData = await convertRes.json();
        if (!cancelled && convertData.project) {
          const p = convertData.project;
          // Functional update, checked against the *current* phase, not the "idle" it was at
          // mount: these two fetches take long enough that an already-signed-in visitor can
          // start their own prompt before this resolves — don't clobber that with the
          // conversion recap just because a leftover guest session also happened to exist.
          setState((prev) =>
            prev.phase === "idle"
              ? {
                  phase: "converted",
                  projectId: p.projectId,
                  prompt: p.prompt,
                  sections: p.sections,
                  lowConfidence: p.lowConfidence,
                  stack: p.stack,
                  hasBoilerplate: p.hasBoilerplate,
                }
              : prev
          );
        }
      } catch {
        // best effort — on failure the user just lands on the normal guest flow
      }
    }

    checkAndConvert();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;

    setState({ phase: "submitting" });
    try {
      const res = await fetch("/api/prompt/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, hints: hints() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setState({ phase: "error", message: data.error ?? "Something went wrong. Please try again." });
        return;
      }

      if (data.needsClarification) {
        setState({ phase: "clarifying", question: data.clarifyingQuestion, submitting: false });
        return;
      }

      setState({ phase: "result", sections: data.sections, lowConfidence: data.lowConfidence });
    } catch {
      setState({ phase: "error", message: "Network error — please try again." });
    }
  }

  async function handleClarify(e: React.FormEvent) {
    e.preventDefault();
    if (state.phase !== "clarifying" || !answer.trim()) return;

    setState({ ...state, submitting: true });
    try {
      const res = await fetch("/api/prompt/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      const data = await res.json();

      if (!res.ok) {
        setState({ phase: "error", message: data.error ?? "Something went wrong. Please try again." });
        return;
      }

      setState({ phase: "result", sections: data.sections, lowConfidence: data.lowConfidence });
    } catch {
      setState({ phase: "error", message: "Network error — please try again." });
    }
  }

  function startOver() {
    setPrompt("");
    setAnswer("");
    setState({ phase: "idle" });
    setEditingKey(null);
    setDraftContent("");
    setSectionBusyKey(null);
    setSectionError(null);
    setStack(null);
    setStackStale(false);
    setStackError(null);
    setOverridingCategory(null);
    setOverrideChoice("");
    setBoilerplateJobId(null);
    setBoilerplateJobState("idle");
    setBoilerplateProgress(0);
    setBoilerplateMessage("");
    setBoilerplateError(null);
    setBoilerplateStale(false);
    setBoilerplateWebContainerCompatible(null);
    setBoilerplateUnvalidated(false);
    setBoilerplateBuildVerified(false);
    setSessionTtlSeconds(null);
    setShowExitConfirm(false);
  }

  function requestStartOver() {
    setShowExitConfirm(true);
  }

  async function discardAndStartOver() {
    setExiting(true);
    try {
      await fetch("/api/guest/exit", { method: "POST" });
    } catch {
      // best effort — proceed with the local reset regardless; the R2 lifecycle rule and
      // Redis TTL remain as the backstop if this particular purge call failed
    } finally {
      setExiting(false);
      startOver();
    }
  }

  function handleSignUpClick() {
    // Defensive: disabled buttons don't fire onClick, but this guards any other call site too —
    // converting while a boilerplate job is still running would orphan it (see boilerplateJobActive).
    if (boilerplateJobActive) return;
    signingInRef.current = true;
    signIn("github", { redirectTo: "/" });
  }

  async function keepWorking() {
    setKeepingWorking(true);
    try {
      const res = await fetch("/api/guest/heartbeat", { method: "POST" });
      const data = await res.json();
      if (res.ok) setSessionTtlSeconds(data.ttlSeconds);
    } catch {
      // transient — the regular poll will pick up the real state on its next tick
    } finally {
      setKeepingWorking(false);
    }
  }

  function startEdit(section: PrdSection) {
    setEditingKey(section.key);
    setDraftContent(section.content);
    setSectionError(null);
  }

  function cancelEdit() {
    setEditingKey(null);
    setDraftContent("");
  }

  async function saveEdit(sectionKey: string) {
    if (!draftContent.trim()) return;
    setSectionBusyKey(sectionKey);
    setSectionError(null);
    try {
      const res = await fetch("/api/prd/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionKey, content: draftContent }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSectionError(data.error ?? "Couldn't save the edit. Please try again.");
        return;
      }
      setState((prev) => (prev.phase === "result" ? { ...prev, sections: data.sections } : prev));
      if (stack && data.stackStale) setStackStale(true);
      if (boilerplateJobState === "succeeded" && data.boilerplateStale) setBoilerplateStale(true);
      setEditingKey(null);
    } catch {
      setSectionError("Network error — please try again.");
    } finally {
      setSectionBusyKey(null);
    }
  }

  async function regenerateSection(sectionKey: string) {
    setSectionBusyKey(sectionKey);
    setSectionError(null);
    try {
      const res = await fetch("/api/prd/regenerate-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSectionError(data.error ?? "Couldn't regenerate this section. Please try again.");
        return;
      }
      setState((prev) => (prev.phase === "result" ? { ...prev, sections: data.sections } : prev));
      if (stack && data.stackStale) setStackStale(true);
      if (boilerplateJobState === "succeeded" && data.boilerplateStale) setBoilerplateStale(true);
    } catch {
      setSectionError("Network error — please try again.");
    } finally {
      setSectionBusyKey(null);
    }
  }

  async function generateStack() {
    setStackLoading(true);
    setStackError(null);
    try {
      const res = await fetch("/api/stack/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hints: hints() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStackError(data.error ?? "Couldn't generate a stack recommendation. Please try again.");
        return;
      }
      setStack(data.stack);
      setStackStale(false);
      if (boilerplateJobState === "succeeded" && data.boilerplateStale) setBoilerplateStale(true);
    } catch {
      setStackError("Network error — please try again.");
    } finally {
      setStackLoading(false);
    }
  }

  function startOverride(category: StackCategory, currentChoice: string) {
    setOverridingCategory(category);
    setOverrideChoice(currentChoice);
    setStackError(null);
  }

  function cancelOverride() {
    setOverridingCategory(null);
    setOverrideChoice("");
  }

  async function saveOverride(category: StackCategory) {
    if (!overrideChoice.trim()) return;
    setStackLoading(true);
    setStackError(null);
    try {
      const res = await fetch("/api/stack/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, choice: overrideChoice }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStackError(data.error ?? "Couldn't save the override. Please try again.");
        return;
      }
      setStack(data.stack);
      setOverridingCategory(null);
      if (boilerplateJobState === "succeeded" && data.boilerplateStale) setBoilerplateStale(true);
    } catch {
      setStackError("Network error — please try again.");
    } finally {
      setStackLoading(false);
    }
  }

  function pollBoilerplateJob(jobId: string) {
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/status`);
        const data = await res.json();

        if (!res.ok) {
          setBoilerplateJobState("failed");
          setBoilerplateError(data.error ?? "Lost track of the job.");
          return;
        }

        setBoilerplateProgress(data.progress);
        setBoilerplateMessage(data.message);

        if (data.state === "succeeded") {
          setBoilerplateJobState("succeeded");
          setBoilerplateStale(false);
          setBoilerplateWebContainerCompatible(data.webContainerCompatible ?? true);
          setBoilerplateUnvalidated(Boolean(data.unvalidated));
          return;
        }
        if (data.state === "failed") {
          setBoilerplateJobState("failed");
          setBoilerplateError(data.error ?? "Boilerplate generation failed.");
          return;
        }

        setBoilerplateJobState(data.state);
        setTimeout(poll, 1800);
      } catch {
        setTimeout(poll, 1800);
      }
    };
    poll();
  }

  async function generateBoilerplate() {
    setBoilerplateError(null);
    setBoilerplateJobState("pending");
    setBoilerplateProgress(0);
    setBoilerplateMessage("Queued");
    setBoilerplateWebContainerCompatible(null);
    setBoilerplateUnvalidated(false);
    setBoilerplateBuildVerified(false);
    try {
      const res = await fetch("/api/boilerplate/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setBoilerplateJobState("idle");
        setBoilerplateError(data.error ?? "Couldn't start boilerplate generation. Please try again.");
        return;
      }
      setBoilerplateJobId(data.jobId);
      pollBoilerplateJob(data.jobId);
    } catch {
      setBoilerplateJobState("idle");
      setBoilerplateError("Network error — please try again.");
    }
  }

  async function retryBoilerplate() {
    if (!boilerplateJobId) return;
    setBoilerplateError(null);
    try {
      const res = await fetch(`/api/jobs/${boilerplateJobId}/retry`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setBoilerplateError(data.error ?? "Couldn't retry. Please try again.");
        return;
      }
      setBoilerplateJobState("pending");
      setBoilerplateProgress(0);
      setBoilerplateMessage("Queued");
      pollBoilerplateJob(boilerplateJobId);
    } catch {
      setBoilerplateError("Network error — please try again.");
    }
  }

  async function generateIdea() {
    setIdeaLoading(true);
    setIdeaError(null);
    try {
      const res = await fetch("/api/ideas/random", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setIdeaError(data.error ?? "Couldn't generate an idea. Please try again.");
        return;
      }
      setIdea(data);
    } catch {
      setIdeaError("Network error — please try again.");
    } finally {
      setIdeaLoading(false);
    }
  }

  // "Use this idea" only populates the prompt — it never starts the pipeline by itself (PRD §6.1.1).
  function useIdea() {
    if (!idea) return;
    setPrompt(`${idea.title}: ${idea.description}`);
    setPlatform(idea.platformTag);
    setIdea(null);
    setIdeaError(null);
  }

  const isSubmitting = state.phase === "submitting" || (state.phase === "clarifying" && state.submitting);

  return (
    <main className="flex-1 mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">What To Do?</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Describe an app idea. Get a PRD, a tech stack, a boilerplate, and a live preview from one prompt.
      </p>

      {(state.phase === "idle" || state.phase === "submitting" || state.phase === "error") && (
        <div className="mt-8 rounded-md border border-neutral-300 dark:border-neutral-700 p-4">
          <p className="text-sm font-medium">Stuck on thinking what to do?</p>

          {!idea && (
            <button
              type="button"
              onClick={generateIdea}
              disabled={ideaLoading || isSubmitting}
              className="mt-2 rounded-md border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {ideaLoading ? "Generating…" : "Generate an idea"}
            </button>
          )}

          {idea && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{idea.title}</span>
                <span className="rounded-full border border-neutral-300 dark:border-neutral-700 px-2 py-0.5 text-xs uppercase tracking-wide text-neutral-500">
                  {idea.platformTag}
                </span>
              </div>
              <p className="text-sm text-neutral-700 dark:text-neutral-300">{idea.description}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={useIdea}
                  disabled={isSubmitting}
                  className="rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                >
                  Use this idea
                </button>
                <button
                  type="button"
                  onClick={generateIdea}
                  disabled={ideaLoading || isSubmitting}
                  className="rounded-md border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                >
                  {ideaLoading ? "Generating…" : "Randomize again"}
                </button>
              </div>
            </div>
          )}

          {ideaError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="status" aria-live="polite">
              {ideaError}
            </p>
          )}
        </div>
      )}

      {(state.phase === "idle" || state.phase === "submitting" || state.phase === "error") && (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4" aria-busy={isSubmitting}>
          <div>
            <label htmlFor={promptId} className="block text-sm font-medium">
              Your app idea
            </label>
            <textarea
              id={promptId}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
              rows={4}
              disabled={isSubmitting}
              placeholder="A tool that helps freelancers track invoices and send payment reminders..."
              className="mt-1 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-neutral-100"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor={platformId} className="block text-sm font-medium">
                Platform <span className="text-neutral-500 font-normal">(optional)</span>
              </label>
              <select
                id={platformId}
                value={platform}
                onChange={(e) => setPlatform(e.target.value as PlatformHint | "")}
                disabled={isSubmitting}
                className="mt-1 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm"
              >
                <option value="">No preference</option>
                <option value="web">Web</option>
                <option value="mobile">Mobile</option>
              </select>
            </div>

            <div>
              <label htmlFor={scopeId} className="block text-sm font-medium">
                Scope <span className="text-neutral-500 font-normal">(optional)</span>
              </label>
              <select
                id={scopeId}
                value={scopeSize}
                onChange={(e) => setScopeSize(e.target.value as ScopeSizeHint | "")}
                disabled={isSubmitting}
                className="mt-1 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm"
              >
                <option value="">No preference</option>
                <option value="weekend">Weekend project</option>
                <option value="mvp">MVP</option>
                <option value="production">Production app</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor={stackId} className="block text-sm font-medium">
              Stacks you already know <span className="text-neutral-500 font-normal">(optional)</span>
            </label>
            <input
              id={stackId}
              type="text"
              value={stackFamiliarity}
              onChange={(e) => setStackFamiliarity(e.target.value)}
              disabled={isSubmitting}
              placeholder="e.g. React, Postgres"
              className="mt-1 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !prompt.trim()}
            className="rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isSubmitting ? "Generating…" : "Generate PRD"}
          </button>

          <p className="text-sm" role="status" aria-live="polite">
            {state.phase === "submitting" && "Generating your PRD, usually under 10 seconds…"}
            {state.phase === "error" && <span className="text-red-600 dark:text-red-400">{state.message}</span>}
          </p>
        </form>
      )}

      {state.phase === "clarifying" && (
        <form onSubmit={handleClarify} className="mt-8 space-y-4" aria-busy={state.submitting}>
          <p className="text-sm font-medium">{state.question}</p>
          <label htmlFor={answerId} className="sr-only">
            Your answer
          </label>
          <textarea
            id={answerId}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            required
            rows={3}
            disabled={state.submitting}
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-neutral-100"
          />
          <button
            type="submit"
            disabled={state.submitting || !answer.trim()}
            className="rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {state.submitting ? "Generating…" : "Continue"}
          </button>
          <p className="text-sm" role="status" aria-live="polite">
            {state.submitting && "Generating your PRD…"}
          </p>
        </form>
      )}

      {state.phase === "result" && (
        <div className="mt-8 space-y-6">
          {sessionTtlSeconds !== null && sessionTtlSeconds < TIMEOUT_WARNING_THRESHOLD_SECONDS ? (
            <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
              <p role="status" aria-live="polite">
                Your session expires in {formatDuration(sessionTtlSeconds)} due to inactivity — guest work isn&apos;t
                saved.
              </p>
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  onClick={keepWorking}
                  disabled={keepingWorking}
                  className="rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  {keepingWorking ? "Refreshing…" : "Keep working"}
                </button>
                <button
                  type="button"
                  onClick={handleSignUpClick}
                  disabled={boilerplateJobActive}
                  title={boilerplateJobActive ? "Wait for boilerplate generation to finish first" : undefined}
                  className="text-xs font-medium underline disabled:no-underline disabled:opacity-50"
                >
                  Sign up to save
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-neutral-500">
              Guest session — your work isn&apos;t saved.{" "}
              <button
                type="button"
                onClick={handleSignUpClick}
                disabled={boilerplateJobActive}
                title={boilerplateJobActive ? "Wait for boilerplate generation to finish first" : undefined}
                className="underline disabled:no-underline disabled:opacity-50"
              >
                Sign up to save
              </button>
              {boilerplateJobActive && " (available once boilerplate generation finishes)"}
            </p>
          )}

          {state.lowConfidence && (
            <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
              This PRD is low-confidence — the idea was still pretty thin after clarification. Worth reviewing closely before generating a stack.
            </div>
          )}
          {sectionError && (
            <p className="text-sm text-red-600 dark:text-red-400" role="status" aria-live="polite">
              {sectionError}
            </p>
          )}
          {state.sections.map((section) => {
            const isEditing = editingKey === section.key;
            const isBusy = sectionBusyKey === section.key;
            const anyBusy = sectionBusyKey !== null;

            return (
              <section key={section.key}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">{section.title}</h2>
                  {!isEditing && (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => startEdit(section)}
                        disabled={anyBusy}
                        className="text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:underline disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => regenerateSection(section.key)}
                        disabled={anyBusy}
                        className="text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:underline disabled:opacity-50"
                      >
                        {isBusy ? "Regenerating…" : "Regenerate"}
                      </button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="mt-1 space-y-2">
                    <label htmlFor={`${sectionEditId}-${section.key}`} className="sr-only">
                      Edit {section.title}
                    </label>
                    <textarea
                      id={`${sectionEditId}-${section.key}`}
                      value={draftContent}
                      onChange={(e) => setDraftContent(e.target.value)}
                      rows={4}
                      disabled={isBusy}
                      className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-neutral-100"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => saveEdit(section.key)}
                        disabled={isBusy || !draftContent.trim()}
                        className="rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                      >
                        {isBusy ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={isBusy}
                        className="rounded-md border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
                    {isBusy ? "Regenerating…" : section.content}
                  </p>
                )}
              </section>
            );
          })}

          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">Tech Stack</h2>
              {stack && (
                <button
                  type="button"
                  onClick={generateStack}
                  disabled={stackLoading}
                  className="text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:underline disabled:opacity-50"
                >
                  {stackLoading ? "Regenerating…" : "Regenerate stack"}
                </button>
              )}
            </div>

            {/*
              These mirror the intake form's hint fields, which only ever apply to the very
              first prompt submission — there's otherwise no way to bias the stack recommendation
              (e.g. "I know FastAPI") once a PRD already exists. Editable here too, and sent on
              every generate/regenerate.
            */}
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              Prefilled from your answers above — adjust these to refine the stack recommendation.
            </p>
            <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                id={platformId}
                value={platform}
                onChange={(e) => setPlatform(e.target.value as PlatformHint | "")}
                disabled={stackLoading}
                aria-label="Platform preference"
                className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1.5 text-xs"
              >
                <option value="">Platform: no preference</option>
                <option value="web">Platform: Web</option>
                <option value="mobile">Platform: Mobile</option>
              </select>
              <select
                id={scopeId}
                value={scopeSize}
                onChange={(e) => setScopeSize(e.target.value as ScopeSizeHint | "")}
                disabled={stackLoading}
                aria-label="Scope size"
                className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1.5 text-xs"
              >
                <option value="">Scope: no preference</option>
                <option value="weekend">Scope: Weekend project</option>
                <option value="mvp">Scope: MVP</option>
                <option value="production">Scope: Production app</option>
              </select>
              <input
                id={stackId}
                type="text"
                value={stackFamiliarity}
                onChange={(e) => setStackFamiliarity(e.target.value)}
                disabled={stackLoading}
                placeholder="Stacks you know, e.g. FastAPI, Vue"
                className="rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1.5 text-xs"
              />
            </div>

            {stackStale && stack && (
              <div className="mt-2 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
                The PRD changed since this stack was generated — it may be out of date.
              </div>
            )}

            {stackError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="status" aria-live="polite">
                {stackError}
              </p>
            )}

            {!stack && (
              <button
                type="button"
                onClick={generateStack}
                disabled={stackLoading}
                className="mt-3 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {stackLoading ? "Generating…" : "Generate Tech Stack"}
              </button>
            )}

            {stack && (
              <div className="mt-3 space-y-4">
                {STACK_CATEGORIES.map(({ key, label }) => {
                  const piece = stack[key];
                  const isOverriding = overridingCategory === key;

                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                          {label}
                        </h3>
                        {!isOverriding && (
                          <button
                            type="button"
                            onClick={() => startOverride(key, piece.choice)}
                            disabled={stackLoading}
                            className="text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:underline disabled:opacity-50"
                          >
                            Override
                          </button>
                        )}
                      </div>

                      {isOverriding ? (
                        <div className="mt-1 space-y-2">
                          <label htmlFor={`${stackOverrideId}-${key}`} className="sr-only">
                            Override {label}
                          </label>
                          <input
                            id={`${stackOverrideId}-${key}`}
                            list={`${stackOverrideId}-${key}-options`}
                            type="text"
                            value={overrideChoice}
                            onChange={(e) => setOverrideChoice(e.target.value)}
                            disabled={stackLoading}
                            className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-neutral-100"
                          />
                          <datalist id={`${stackOverrideId}-${key}-options`}>
                            {STACK_ALTERNATIVES[key].map((alt) => (
                              <option key={alt} value={alt} />
                            ))}
                          </datalist>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => saveOverride(key)}
                              disabled={stackLoading || !overrideChoice.trim()}
                              className="rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                            >
                              {stackLoading ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelOverride}
                              disabled={stackLoading}
                              className="rounded-md border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="mt-1 text-sm font-medium">{piece.choice}</p>
                          <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">{piece.rationale}</p>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {stack && (
            <div className="border-t border-neutral-200 dark:border-neutral-800 pt-6">
              <h2 className="text-xl font-semibold">Boilerplate</h2>

              {boilerplateStale && boilerplateJobState === "succeeded" && (
                <div className="mt-2 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
                  The stack changed since this boilerplate was generated — it may be out of date.
                </div>
              )}

              {boilerplateError && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="status" aria-live="polite">
                  {boilerplateError}
                </p>
              )}

              {boilerplateJobState === "idle" && (
                <button
                  type="button"
                  onClick={generateBoilerplate}
                  className="mt-3 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-medium"
                >
                  Generate Boilerplate
                </button>
              )}

              {(boilerplateJobState === "pending" || boilerplateJobState === "running") && (
                <div className="mt-3">
                  <div className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                    <div
                      className="h-full bg-neutral-900 dark:bg-neutral-100 transition-all"
                      style={{ width: `${boilerplateProgress}%` }}
                    />
                  </div>
                  <p className="mt-2 text-sm" role="status" aria-live="polite">
                    {boilerplateMessage}
                  </p>
                </div>
              )}

              {boilerplateJobState === "failed" && (
                <button
                  type="button"
                  onClick={retryBoilerplate}
                  className="mt-3 rounded-md border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm font-medium"
                >
                  Retry
                </button>
              )}

              {boilerplateJobState === "succeeded" && (
                <div className="mt-3 flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                    <p
                      className={
                        boilerplateUnvalidated
                          ? "text-sm text-amber-700 dark:text-amber-400"
                          : "text-sm text-green-700 dark:text-green-400"
                      }
                    >
                      {boilerplateUnvalidated
                        ? "Boilerplate generated — no Python interpreter was available to check it, review before running."
                        : boilerplateWebContainerCompatible === false
                          ? "Boilerplate generated (Python syntax checked)."
                          : boilerplateBuildVerified
                            ? "Boilerplate generated and verified — Live Preview confirmed it builds and runs."
                            : "Boilerplate generated (syntax-checked) — open Live Preview to confirm it actually builds and runs."}
                    </p>
                    <a
                      href="/api/boilerplate/download"
                      className="rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-medium"
                    >
                      Download zip
                    </a>
                    {boilerplateJobId && (
                      <a
                        href={`/preview/${boilerplateJobId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm font-medium"
                      >
                        {boilerplateWebContainerCompatible === false ? "View files" : "Live Preview"}
                      </a>
                    )}
                  </div>
                  {boilerplateWebContainerCompatible === false && (
                    <p className="text-xs text-neutral-500">
                      Live preview isn&apos;t available for this stack — download the zip and run it locally (see
                      the included README for the exact command).
                    </p>
                  )}
                  {boilerplateStale && (
                    <button
                      type="button"
                      onClick={generateBoilerplate}
                      className="text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:underline"
                    >
                      Regenerate
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {!showExitConfirm ? (
            <button
              type="button"
              onClick={requestStartOver}
              className="rounded-md border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm font-medium"
            >
              Start over
            </button>
          ) : (
            <div className="rounded-md border border-neutral-300 dark:border-neutral-700 p-4 space-y-2">
              <p className="text-sm font-medium">Sign up to save this project before starting over?</p>
              {boilerplateJobActive && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Boilerplate is still generating — sign-up isn&apos;t available until it finishes.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSignUpClick}
                  disabled={boilerplateJobActive}
                  className="rounded-md border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                >
                  Sign up to save
                </button>
                <button
                  type="button"
                  onClick={discardAndStartOver}
                  disabled={exiting}
                  className="rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                >
                  {exiting ? "Discarding…" : "Discard & start over"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowExitConfirm(false)}
                  disabled={exiting}
                  className="text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:underline disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {state.phase === "converted" && (
        <div className="mt-8 space-y-6">
          <div className="rounded-md border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-200">
            Saved to your account.
          </div>

          <div>
            <h2 className="text-lg font-semibold">Your idea</h2>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">{state.prompt}</p>
          </div>

          {state.sections.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold">PRD sections</h2>
              <ul className="mt-2 list-disc list-inside text-sm text-neutral-700 dark:text-neutral-300">
                {state.sections.map((section) => (
                  <li key={section.key}>{section.title}</li>
                ))}
              </ul>
            </div>
          )}

          {state.stack && (
            <div>
              <h2 className="text-lg font-semibold">Tech stack</h2>
              <ul className="mt-2 text-sm text-neutral-700 dark:text-neutral-300 space-y-1">
                {STACK_CATEGORIES.map(({ key, label }) => (
                  <li key={key}>
                    <span className="font-medium">{label}:</span> {state.stack![key].choice}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.hasBoilerplate && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              A generated boilerplate was saved with this project too. If you&apos;ve turned on GitHub auto-push in{" "}
              <a href="/account" className="underline">
                account settings
              </a>
              , a repo is being created for it now.
            </p>
          )}

          <p className="text-xs text-neutral-500">
            Full editing and a project dashboard for signed-in accounts are coming soon — for now,{" "}
            <a href="/account" className="underline">
              your account page
            </a>{" "}
            confirms you&apos;re signed in.
          </p>

          <button
            type="button"
            onClick={startOver}
            className="rounded-md border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm font-medium"
          >
            Start a new project
          </button>
        </div>
      )}
    </main>
  );
}
