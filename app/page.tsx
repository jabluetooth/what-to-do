"use client";

import { useId, useState } from "react";
import type { PlatformHint, PrdSection, RandomIdea, ScopeSizeHint } from "@/lib/types";

type FlowState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "clarifying"; question: string; submitting: boolean }
  | { phase: "result"; sections: PrdSection[]; lowConfidence: boolean }
  | { phase: "error"; message: string };

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

  const promptId = useId();
  const platformId = useId();
  const scopeId = useId();
  const stackId = useId();
  const answerId = useId();

  const hints = () => ({
    platform: platform || undefined,
    scopeSize: scopeSize || undefined,
    stackFamiliarity: stackFamiliarity.trim() || undefined,
  });

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
          {state.lowConfidence && (
            <div className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
              This PRD is low-confidence — the idea was still pretty thin after clarification. Worth reviewing closely before generating a stack.
            </div>
          )}
          {state.sections.map((section) => (
            <section key={section.key}>
              <h2 className="text-lg font-semibold">{section.title}</h2>
              <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
                {section.content}
              </p>
            </section>
          ))}
          <button
            type="button"
            onClick={startOver}
            className="rounded-md border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm font-medium"
          >
            Start over
          </button>
        </div>
      )}
    </main>
  );
}
