"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
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

const SCRAMBLE_CHARS = "!<>-_\\/[]{}—=+*^?#0123456789";
const SCRAMBLE_DURATION_MS = 900;
const LOADING_SCRAMBLE_INTERVAL_MS = 90;
const PLACEHOLDER_TITLE = "Generate one at random";
const PLACEHOLDER_TARGET = "Get a PRD, tech stack, boilerplate, and live preview from one idea.";

function randomScrambleString(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
  return out;
}

/**
 * Two phases, one persistent component (it must never unmount between them — an earlier version
 * swapped between a plain <span> and this component depending on `loading`, which remounted it
 * on every landing and made the reveal below always skip straight to the final text):
 *
 * - While `loading`: continuously re-randomizes every character, purely as a "generating"
 *   indicator — never resolves to anything, never stops on its own.
 * - Once `loading` ends and `play` has changed since the last reveal: locks `text` in
 *   left-to-right over SCRAMBLE_DURATION_MS, random characters standing in for the unrevealed
 *   tail. A `play` that hasn't changed (e.g. `loading` toggling with no fresh idea behind it)
 *   just swaps `display` to `text` instantly instead of animating or going stale.
 */
function TextScramble({
  text,
  play,
  loading,
  className,
}: {
  text: string;
  play: number;
  loading: boolean;
  className?: string;
}) {
  const [display, setDisplay] = useState(text);
  const frameRef = useRef<number | null>(null);
  const lastPlayRef = useRef(play);

  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => setDisplay(randomScrambleString(text.length)), LOADING_SCRAMBLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loading, text]);

  useEffect(() => {
    if (loading) return;
    if (play === lastPlayRef.current) {
      setDisplay(text);
      return;
    }
    lastPlayRef.current = play;

    const start = performance.now();
    function tick(now: number) {
      const progress = Math.min((now - start) / SCRAMBLE_DURATION_MS, 1);
      const lockedCount = Math.floor(progress * text.length);
      let out = "";
      for (let i = 0; i < text.length; i++) {
        out += i < lockedCount || text[i] === " " ? text[i] : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
      }
      setDisplay(out);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(text);
      }
    }
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [loading, play, text]);

  return (
    <span className={className} aria-hidden="true">
      {display}
    </span>
  );
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

const ABOUT_STEPS = [
  {
    title: "Start with an idea",
    body: "Describe your own, or generate a random one to get unstuck.",
  },
  {
    title: "Get a PRD",
    body: "A scoped product spec — problem, target user, MVP features — generated in seconds, editable section by section.",
  },
  {
    title: "Pick a tech stack",
    body: "A curated recommendation, not a black box — override any piece if you already know what you want.",
  },
  {
    title: "Generate boilerplate & preview it live",
    body: "Scaffolded code from your stack, running in-browser via WebContainers before you download it.",
  },
];

const FAQ_ITEMS = [
  {
    q: "Do I need to sign up?",
    a: "No. The whole flow — idea, PRD, tech stack, boilerplate, live preview — works as a guest. Sign in with GitHub only if you want to keep a project past your guest session, or push the generated code straight to a new repo.",
  },
  {
    q: "How long does my guest session last?",
    a: "Guest work is kept for a limited time and purged automatically after inactivity. Sign in before it expires to keep it.",
  },
  {
    q: "Can I push the generated code to GitHub?",
    a: "Yes, optionally. Sign in, grant repo access from your account page, and turn on auto-push — a private repo is created the next time you save a project.",
  },
  {
    q: "Is the generated boilerplate actually tested?",
    a: "It's checked for syntax errors automatically. Opening the live preview goes further, actually installing and running it in-browser so you can confirm it builds before downloading.",
  },
  {
    q: "Is there a limit to how many times I can generate?",
    a: "Yes, a small daily cap per stage to keep things fair on a free tier — signing in raises the limit.",
  },
];

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
  // The manual prompt form is collapsed behind this by default — the landing page's primary path
  // is the random idea generator, not typing a prompt.
  const [showManualForm, setShowManualForm] = useState(false);
  // Bumped only when a new idea actually lands — TextScramble replays its reveal on a change,
  // never on mount (starts at 0, see its own "play === lastPlayRef.current" guard).
  const [scrambleKey, setScrambleKey] = useState(0);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [showSignInModal, setShowSignInModal] = useState(false);

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
        const signedIn = Boolean(sessionData?.user);
        if (!cancelled) setIsSignedIn(signedIn);
        if (cancelled || !signedIn) return;

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

  useEffect(() => {
    if (!showSignInModal) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowSignInModal(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSignInModal]);

  async function submitPrompt(promptText: string, hintOverrides?: Partial<ReturnType<typeof hints>>) {
    if (!promptText.trim()) return;

    setState({ phase: "submitting" });
    try {
      const res = await fetch("/api/prompt/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText, hints: { ...hints(), ...hintOverrides } }),
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submitPrompt(prompt);
  }

  // The hero's "Generate PRD" action from a random idea — passes the platform hint explicitly
  // rather than relying on setPlatform() having landed before this reads it (same render tick).
  async function startPrdFromIdea() {
    if (!idea) return;
    const promptText = `${idea.title} (${idea.targetUser}): ${idea.description}`;
    setPrompt(promptText);
    setPlatform(idea.platformTag);
    await submitPrompt(promptText, { platform: idea.platformTag });
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
    setIdea(null);
    setIdeaError(null);
    setShowManualForm(false);
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
      setScrambleKey((k) => k + 1);
    } catch {
      setIdeaError("Network error — please try again.");
    } finally {
      setIdeaLoading(false);
    }
  }

  const isSubmitting = state.phase === "submitting" || (state.phase === "clarifying" && state.submitting);

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed top-0 left-0 right-0 z-50 flex justify-center pb-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pointer-events-none"
      >
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-neutral-200 dark:border-white/10 bg-white/80 dark:bg-neutral-900/70 backdrop-blur-xl shadow-lg p-1.5">
          <Link
            href="/"
            className="rounded-full px-4 py-2 text-sm font-extrabold tracking-tighter hover:bg-neutral-100 dark:hover:bg-white/10"
          >
            WTD
          </Link>
          <div className="hidden sm:block h-4 w-px bg-neutral-200 dark:bg-white/10 mx-1" />
          <div className="hidden sm:flex items-center gap-1">
            <a
              href="#about"
              className="rounded-full px-3.5 py-2 text-sm font-medium text-neutral-500 dark:text-neutral-400 transition-colors hover:bg-neutral-100 dark:hover:bg-white/10 hover:text-neutral-900 dark:hover:text-white"
            >
              About
            </a>
            <a
              href="#faq"
              className="rounded-full px-3.5 py-2 text-sm font-medium text-neutral-500 dark:text-neutral-400 transition-colors hover:bg-neutral-100 dark:hover:bg-white/10 hover:text-neutral-900 dark:hover:text-white"
            >
              FAQ
            </a>
          </div>
          <div className="h-4 w-px bg-neutral-200 dark:bg-white/10 mx-1" />
          {isSignedIn ? (
            <Link
              href="/account"
              className="rounded-full bg-neutral-900 dark:bg-white px-4 py-2 text-sm font-bold text-white dark:text-neutral-900 transition-colors hover:bg-neutral-700 dark:hover:bg-neutral-200"
            >
              Account
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setShowSignInModal(true)}
              className="rounded-full bg-neutral-900 dark:bg-white px-4 py-2 text-sm font-bold text-white dark:text-neutral-900 transition-colors hover:bg-neutral-700 dark:hover:bg-neutral-200"
            >
              Sign in
            </button>
          )}
        </div>
      </nav>

      <main className="flex-1 mx-auto w-full max-w-2xl px-6 pt-28 pb-16">
      {(state.phase === "idle" || state.phase === "submitting" || state.phase === "error") && (
        <>
          <div className="mt-10 text-center">
            <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
              {idea || ideaLoading ? "Your next app" : "Stuck on what to build?"}
            </p>

            <h2 className="mt-2 text-4xl sm:text-5xl font-bold tracking-tight">
              <TextScramble text={idea ? idea.title : PLACEHOLDER_TITLE} play={scrambleKey} loading={ideaLoading} />
            </h2>
            <p className="mt-2 text-lg sm:text-xl text-neutral-500 dark:text-neutral-400">
              <TextScramble
                text={idea ? idea.targetUser : PLACEHOLDER_TARGET}
                play={scrambleKey}
                loading={ideaLoading}
              />
            </p>

            {idea && !ideaLoading && (
              <div className="mt-4 flex flex-col items-center gap-2">
                <span className="inline-block rounded-full border border-neutral-300 dark:border-neutral-700 px-2 py-0.5 text-xs uppercase tracking-wide text-neutral-500">
                  {idea.platformTag}
                </span>
                <p className="mx-auto max-w-prose text-sm text-neutral-700 dark:text-neutral-300">{idea.description}</p>
              </div>
            )}

            {/* A visible shuffle is distracting to announce frame-by-frame — screen readers get
                just the loading state and the final landed idea. */}
            <p className="sr-only" role="status" aria-live="polite">
              {ideaLoading && "Generating an idea…"}
              {idea && !ideaLoading && `Idea: ${idea.title}, ${idea.targetUser}. ${idea.description}`}
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
              {!idea && (
                <button
                  type="button"
                  onClick={generateIdea}
                  disabled={ideaLoading || isSubmitting}
                  className="rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-5 py-2.5 text-sm font-medium disabled:opacity-50"
                >
                  {ideaLoading ? "Generating…" : "Generate an app idea"}
                </button>
              )}

              {idea && (
                <>
                  <button
                    type="button"
                    onClick={startPrdFromIdea}
                    disabled={isSubmitting}
                    className="rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-5 py-2.5 text-sm font-medium disabled:opacity-50"
                  >
                    {isSubmitting ? "Generating…" : "Generate PRD"}
                  </button>
                  <button
                    type="button"
                    onClick={generateIdea}
                    disabled={ideaLoading || isSubmitting}
                    className="rounded-md border border-neutral-300 dark:border-neutral-700 px-5 py-2.5 text-sm font-medium disabled:opacity-50"
                  >
                    {ideaLoading ? "Generating…" : "Regenerate"}
                  </button>
                </>
              )}

              {!showManualForm && (
                <button
                  type="button"
                  onClick={() => setShowManualForm(true)}
                  className="text-sm text-neutral-500 dark:text-neutral-400 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  or describe your own idea →
                </button>
              )}
            </div>

            {ideaError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="status" aria-live="polite">
                {ideaError}
              </p>
            )}

            <p className="mt-3 text-sm" role="status" aria-live="polite">
              {state.phase === "submitting" && "Generating your PRD, usually under 10 seconds…"}
              {state.phase === "error" && <span className="text-red-600 dark:text-red-400">{state.message}</span>}
            </p>
          </div>

          {showManualForm && (
            <form
              onSubmit={handleSubmit}
              className="mt-8 space-y-4 border-t border-neutral-200 dark:border-neutral-800 pt-8"
              aria-busy={isSubmitting}
            >
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
            </form>
          )}
        </>
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

      <section id="about" className="mx-auto w-full max-w-2xl px-6 py-20 border-t border-neutral-200 dark:border-neutral-800">
        <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">About</p>
        <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">From a blank page to a running project</h2>
        <p className="mt-3 text-neutral-600 dark:text-neutral-400 max-w-prose">
          What To Do? turns a single idea into something you can actually run — no account required to try it.
        </p>

        <ol className="mt-8 space-y-6">
          {ABOUT_STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-semibold">
                {i + 1}
              </span>
              <div>
                <p className="font-medium">{step.title}</p>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="faq" className="mx-auto w-full max-w-2xl px-6 py-20 border-t border-neutral-200 dark:border-neutral-800">
        <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">FAQ</p>
        <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">Frequently asked questions</h2>

        <dl className="mt-8 space-y-6">
          {FAQ_ITEMS.map((item) => (
            <div key={item.q}>
              <dt className="font-medium">{item.q}</dt>
              <dd className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="mx-auto w-full max-w-2xl px-6 pt-12 pb-16 border-t border-neutral-200 dark:border-neutral-800">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-8">
          <div>
            <p className="text-sm font-extrabold tracking-tighter">WTD</p>
            <p className="mt-2 max-w-xs text-sm text-neutral-500 dark:text-neutral-400">
              From an idea to a scoped, scaffolded, running project in one prompt.
            </p>
          </div>
          <div className="flex gap-10 text-sm">
            <div className="space-y-2">
              <a
                href="#about"
                className="block text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
              >
                About
              </a>
              <a
                href="#faq"
                className="block text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
              >
                FAQ
              </a>
            </div>
            <div className="space-y-2">
              <Link
                href="/account"
                className="block text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
              >
                Account
              </Link>
            </div>
          </div>
        </div>
        <p className="mt-10 text-xs text-neutral-400 dark:text-neutral-600">© 2026 What To Do?</p>
      </footer>

      {showSignInModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSignInModal(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-in-modal-title"
            className="w-full max-w-sm rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id="sign-in-modal-title" className="text-lg font-semibold">
                Sign in
              </h2>
              <button
                type="button"
                onClick={() => setShowSignInModal(false)}
                aria-label="Close"
                className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            </div>

            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              Save projects past your guest session, push generated code to GitHub, and get a higher generation
              limit.
            </p>

            <button
              type="button"
              onClick={handleSignUpClick}
              disabled={boilerplateJobActive}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-neutral-900 dark:bg-neutral-100 px-4 py-2.5 text-sm font-medium text-white dark:text-neutral-900 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              Continue with GitHub
            </button>

            {boilerplateJobActive && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Wait for the current boilerplate job to finish before signing in.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
