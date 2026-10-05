"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import { signIn } from "next-auth/react";
import type { PlatformHint, PrdSection, RandomIdea, ScopeSizeHint, StackCategory, StackRecommendation } from "@/lib/types";
import { STACK_ALTERNATIVES } from "@/lib/pipeline/stackMatrix";
import { describeGeneratedCode } from "@/lib/pipeline/templateRegistry";
import SiteNav from "@/components/SiteNav";
import CliSection from "@/components/CliSection";
import MobileSection from "@/components/MobileSection";
import CapabilitiesSection from "@/components/CapabilitiesSection";
import Hero from "@/components/Hero";
import IdeaRoller from "@/components/IdeaRoller";
import { Faq, HowItWorks } from "@/components/LandingSections";
import { EASE, Kicker } from "@/components/fx/Reveal";
import Footer from "@/components/Footer";
import { useModalDialog } from "@/lib/useModalDialog";

const SESSION_POLL_INTERVAL_MS = 30_000;
const TIMEOUT_WARNING_THRESHOLD_SECONDS = 5 * 60;

/** color-scheme: dark (globals.css) already makes a <select>'s native options popup render dark
 *  by default, but that's the browser's own generic dark styling — explicit classes here pin it
 *  to this app's actual neutral palette instead, for both themes (kept even though the site
 *  forces dark, matching every other component's dark: pairing in case that forcing is ever
 *  relaxed). Chromium and Firefox both respect background-color/color set directly on <option>;
 *  Safari's support is partial, where it just falls back to color-scheme's default dark styling. */
const OPTION_CLASS = "bg-accent-ink text-accent";

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

/** One small badge icon per PRD section key (lib/llm/prd.ts's PRD_SECTION_DEFS) — purely
    decorative next to each card's title, so always aria-hidden; the visible title text already
    carries the meaning. Falls back to a plain generic square for any section key not listed
    here, since the underlying section list is LLM-driven and could in principle add one. */
function getSectionIcon(key: string) {
  const common = { viewBox: "0 0 24 24", className: "h-3.5 w-3.5", "aria-hidden": true } as const;
  switch (key) {
    case "problem_statement":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="7" x2="12" y2="13" />
          <circle cx="12" cy="16.5" r="0.75" fill="currentColor" stroke="none" />
        </svg>
      );
    case "target_user":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
        </svg>
      );
    case "core_features":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 12 9 17 20 6" />
        </svg>
      );
    case "user_stories":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20l3-4h2l3 4" />
        </svg>
      );
    case "out_of_scope":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    case "complexity_estimate":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15.5 14" />
        </svg>
      );
    default:
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="4" width="16" height="16" rx="2" />
        </svg>
      );
  }
}

function getStackCategoryIcon(key: StackCategory) {
  const common = { viewBox: "0 0 24 24", className: "h-3.5 w-3.5", "aria-hidden": true } as const;
  switch (key) {
    case "frontend":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <line x1="3" y1="8" x2="21" y2="8" />
        </svg>
      );
    case "backend":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="6" rx="1.5" />
          <rect x="3" y="14" width="18" height="6" rx="1.5" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
          <line x1="7" y1="17" x2="7.01" y2="17" />
        </svg>
      );
    case "database":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="6" rx="8" ry="3" />
          <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
          <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
        </svg>
      );
    case "hosting":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 18a4.5 4.5 0 0 1-1-8.9A5.5 5.5 0 0 1 16.5 9a4 4 0 0 1 .5 8H7Z" />
        </svg>
      );
    case "auth":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      );
  }
}

/** Three small pulsing dots — sized independently of the surrounding text via its own font-size. */
function LoadingDots() {
  return (
    <span className="ml-1 inline-flex items-end gap-0.5 text-[6px]" aria-hidden="true">
      <span className="h-[1em] w-[1em] rounded-full bg-current [animation:loading-dot_1.4s_ease-in-out_infinite]" />
      <span className="h-[1em] w-[1em] rounded-full bg-current [animation:loading-dot_1.4s_ease-in-out_infinite] [animation-delay:0.2s]" />
      <span className="h-[1em] w-[1em] rounded-full bg-current [animation:loading-dot_1.4s_ease-in-out_infinite] [animation-delay:0.4s]" />
    </span>
  );
}

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
  // The full-screen idea roller (components/IdeaRoller.tsx). drawNumber bumps once per roll so the
  // roller replays its spin and landing even when two rolls happen to return the same idea.
  const [rollerOpen, setRollerOpen] = useState(false);
  const [drawNumber, setDrawNumber] = useState(0);
  const closeRoller = useCallback(() => setRollerOpen(false), []);
  const [showSignInModal, setShowSignInModal] = useState(false);
  // Distinct from SiteNav's own sign-in check (a separate, simple GET each — consistent with how
  // every other lightweight fetch in this app is independently re-fetched rather than shared).
  // Needed here specifically to pick the right "save this project" behavior below: an
  // already-signed-in visitor generating a fresh guest-session project shouldn't be told to
  // "sign up" or sent through another GitHub OAuth round trip — they should just get a direct
  // save.
  const [isSignedIn, setIsSignedIn] = useState(false);

  const isPostPrd = state.phase === "result" || state.phase === "converted";

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [sectionBusyKey, setSectionBusyKey] = useState<string | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [selectedSectionKey, setSelectedSectionKey] = useState<string | null>(null);

  const selectSection = (key: string) => {
    setSelectedSectionKey((prev) => (prev === key ? null : key));
    if (editingKey && editingKey !== key) {
      setEditingKey(null);
      setDraftContent("");
    }
  };

  const selectedSection =
    state.phase === "result" ? (state.sections.find((s) => s.key === selectedSectionKey) ?? null) : null;
  const isEditingSelected = selectedSection ? editingKey === selectedSection.key : false;
  const isSelectedBusy = selectedSection ? sectionBusyKey === selectedSection.key : false;
  const anySectionBusy = sectionBusyKey !== null;

  // The description panel used to mount the instant a title was selected, as a flex-1 sibling of
  // the title list, while the enclosing box was still mid-width-transition (narrow, centered ->
  // full width). Squeezed into that shrunken width, its text wrapped into many short lines,
  // ballooning the panel's own height well past its final size — and since it was still a normal
  // flex child (not just invisible — an opacity fade doesn't touch layout), that inflated height
  // pushed the box, and everything below it (Continue/Start over), sharply down and back as the
  // box grew and the panel's height settled. Deferring the panel's *mount* (not just its opacity)
  // until the box's own transition has essentially finished means it only ever renders at, or
  // very near, its true final width. Only the box's very first expansion needs the delay — the
  // box is already full width for every later switch between sections, so those show instantly.
  const boxExpandedRef = useRef(false);
  const [showSelectedPanel, setShowSelectedPanel] = useState(false);
  useEffect(() => {
    if (!selectedSectionKey) {
      boxExpandedRef.current = false;
      const timer = setTimeout(() => setShowSelectedPanel(false), 0);
      return () => clearTimeout(timer);
    }
    if (boxExpandedRef.current) {
      const timer = setTimeout(() => setShowSelectedPanel(true), 0);
      return () => clearTimeout(timer);
    }
    boxExpandedRef.current = true;
    const timer = setTimeout(() => setShowSelectedPanel(true), 280);
    return () => clearTimeout(timer);
  }, [selectedSectionKey]);

  // Both slides stay permanently mounted (unlike the hero->result transition, which unmounts the
  // hero after it exits) — the user moves back and forth between PRD and Tech Stack freely, so
  // there's no one-way "done with this" moment to unmount on, and keeping both mounted means a
  // plain CSS transform transition suffices without the double-rAF dance the hero uses to make a
  // freshly-mounted element animate from its starting position.
  const [activeSlide, setActiveSlide] = useState<"prd" | "stack">("prd");

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
  // For the isSignedIn "save directly" path below — a distinct busy/error pair from the
  // sign-up-via-OAuth path (handleSignUpClick), since this one is a same-page fetch, not a
  // full-page redirect, so it needs its own visible pending/failure state.
  const [savingProject, setSavingProject] = useState(false);
  const [saveProjectError, setSaveProjectError] = useState<string | null>(null);
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

  const signInModalRef = useModalDialog(showSignInModal, () => setShowSignInModal(false));
  const manualFormRef = useModalDialog(showManualForm, () => setShowManualForm(false));
  const exitConfirmRef = useModalDialog(showExitConfirm, () => setShowExitConfirm(false));

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
        setShowManualForm(false);
        setRollerOpen(false);
        return;
      }

      setState({ phase: "result", sections: data.sections, lowConfidence: data.lowConfidence });
      setShowManualForm(false);
      setRollerOpen(false);
      window.scrollTo({ top: 0 });
      setSelectedSectionKey(null);
      setActiveSlide("prd");
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

  // Applies a prefilled idea to the same state startPrdFromIdea() reads/sets, wrapped in its own
  // function (rather than inlined) so the URL-hydration effect below only calls opaque functions
  // in its body, not setState directly — keeps it clean under react-hooks/set-state-in-effect.
  function applyIdeaToPromptState(nextIdea: RandomIdea): string {
    const promptText = `${nextIdea.title} (${nextIdea.targetUser}): ${nextIdea.description}`;
    setIdea(nextIdea);
    setPlatform(nextIdea.platformTag);
    setPrompt(promptText);
    return promptText;
  }

  // Mobile app's "Continue building on web" handoff: a favorite's title/targetUser/description/
  // platformTag arrive as query params (see WhatToDo-mobile's lib/webLink.ts) and auto-start the
  // PRD flow, exactly as if the user had generated/picked this idea here. Read window.location
  // directly (rather than useSearchParams) so this stays a plain client-side effect with no
  // Suspense-boundary requirement. Runs at most once per page load — the ref guards against
  // StrictMode's double-invoke, and the URL is scrubbed after consuming so a refresh doesn't replay it.
  const prefillConsumedRef = useRef(false);
  useEffect(() => {
    if (prefillConsumedRef.current) return;
    const params = new URLSearchParams(window.location.search);

    // A prompt the user wrote themselves on mobile (lib/webLink.ts's continuePromptOnWebUrl),
    // with the same optional hints the intake form has.
    const typedPrompt = params.get("prompt")?.trim().slice(0, 2000);
    if (typedPrompt) {
      prefillConsumedRef.current = true;
      const p = params.get("platform");
      const s = params.get("scope");
      const stack = params.get("stack")?.slice(0, 300) ?? "";
      const promptHints = {
        platform: p === "web" || p === "mobile" ? p : undefined,
        scopeSize: s === "weekend" || s === "mvp" || s === "production" ? s : undefined,
        stackFamiliarity: stack || undefined,
      } as const;
      // One-time hydration from the URL on mount, guarded by the ref like the idea case below.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrompt(typedPrompt);
      setPlatform(promptHints.platform ?? "");
      setScopeSize(promptHints.scopeSize ?? "");
      setStackFamiliarity(stack);
      window.history.replaceState(null, "", window.location.pathname);
      void submitPrompt(typedPrompt, promptHints);
      return;
    }

    const title = params.get("title");
    const targetUser = params.get("targetUser");
    const description = params.get("description");
    const platformTag = params.get("platformTag");
    if (!title || !targetUser || !description || (platformTag !== "web" && platformTag !== "mobile")) return;

    prefillConsumedRef.current = true;
    // One-time hydration from the URL on mount, not a reactive sync — the ref above already
    // guards against this ever running more than once, so there's no cascading-render risk.
    const promptText = applyIdeaToPromptState({ title, targetUser, description, platformTag });
    window.history.replaceState(null, "", window.location.pathname);
    setRollerOpen(true);
    void submitPrompt(promptText, { platform: platformTag });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time URL consumption on mount, guarded by the ref above
  }, []);

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
      setSelectedSectionKey(null);
      setActiveSlide("prd");
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
    setRollerOpen(false);
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
    setSaveProjectError(null);
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

  /**
   * The isSignedIn counterpart to handleSignUpClick: the visitor is already authenticated, so
   * there's no OAuth round trip to do — just call the same conversion endpoint the post-OAuth
   * mount effect calls, directly. convertGuestSessionToProject is a one-shot, terminal migration
   * (it deletes the guest session once it succeeds), so this can only ever run once per project
   * — matches the button being replaced by the "converted" phase view right after.
   */
  async function saveToAccount() {
    if (boilerplateJobActive) return;
    setSavingProject(true);
    setSaveProjectError(null);
    try {
      const res = await fetch("/api/account/convert", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSaveProjectError(data.error ?? "Couldn't save your project right now.");
        return;
      }
      if (data.project) {
        const p = data.project;
        setState({
          phase: "converted",
          projectId: p.projectId,
          prompt: p.prompt,
          sections: p.sections,
          lowConfidence: p.lowConfidence,
          stack: p.stack,
          hasBoilerplate: p.hasBoilerplate,
        });
        setShowExitConfirm(false);
      }
    } catch {
      setSaveProjectError("Network error — please try again.");
    } finally {
      setSavingProject(false);
    }
  }

  function saveOrSignUp() {
    if (isSignedIn) void saveToAccount();
    else handleSignUpClick();
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
    // Some picks (e.g. the FastAPI template's "API only" frontend) aren't user-selectable
    // alternatives — start the select on a valid option rather than one the server rejects.
    const options = STACK_ALTERNATIVES[category];
    setOverrideChoice(options.includes(currentChoice) ? currentChoice : options[0]);
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
          setBoilerplateStale(Boolean(data.stale));
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
    setDrawNumber((n) => n + 1);
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

  function rollIdea() {
    setRollerOpen(true);
    void generateIdea();
  }

  const generatedCode = stack ? describeGeneratedCode(stack) : null;
  const isSubmitting = state.phase === "submitting" || (state.phase === "clarifying" && state.submitting);
  // A rolled idea keeps its own short title; a hand-written prompt gets its first few words.
  const projectTitle = idea && prompt.startsWith(idea.title) ? idea.title : prompt.split(/\s+/).slice(0, 6).join(" ");

  return (
    <>
      <SiteNav onSignInClick={() => setShowSignInModal(true)} />

      {(state.phase === "idle" || state.phase === "submitting" || state.phase === "error") && (
        <Hero
          onRoll={rollIdea}
          onWriteOwn={() => setShowManualForm(true)}
          lastIdea={rollerOpen ? null : idea}
          onReopen={() => setRollerOpen(true)}
          disabled={ideaLoading || isSubmitting}
          error={!rollerOpen && !showManualForm && state.phase === "error" ? state.message : null}
        />
      )}

      {state.phase === "clarifying" && (
        <main className="relative mx-auto flex min-h-[100svh] w-full max-w-3xl flex-col justify-center px-5 pb-20 pt-32 sm:px-8">
          <motion.form
            onSubmit={handleClarify}
            aria-busy={state.submitting}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE }}
          >
            <Kicker>One quick question</Kicker>
            <p className="mt-5 font-display text-4xl uppercase leading-[0.95] sm:text-6xl">{state.question}</p>
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
              placeholder="Type your answer…"
              className="mt-8 w-full rounded-2xl border border-line bg-surface px-5 py-4 text-lg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="submit"
              disabled={state.submitting || !answer.trim()}
              className="group mt-5 inline-flex items-center gap-2 rounded-full bg-accent px-7 py-4 text-base font-semibold text-accent-ink transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
            >
              {state.submitting ? (
                <>
                  Writing the spec
                  <LoadingDots />
                </>
              ) : (
                <>
                  Continue
                  <span className="transition-transform group-hover:translate-x-1" aria-hidden="true">
                    →
                  </span>
                </>
              )}
            </button>
            <p className="sr-only" role="status" aria-live="polite">
              {state.submitting && "Generating your PRD…"}
            </p>
          </motion.form>
        </main>
      )}

      {isPostPrd && (
        <main className="relative mx-auto w-full max-w-4xl flex-1 px-5 pb-24 pt-32 sm:px-8">
          <motion.div
            initial={{ opacity: 0, y: 48 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.25 }}
          >
      {state.phase === "result" && (
        <div className="mt-8 space-y-6">
          {sessionTtlSeconds !== null && sessionTtlSeconds < TIMEOUT_WARNING_THRESHOLD_SECONDS ? (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
              <p role="status" aria-live="polite">
                Session ends in {formatDuration(sessionTtlSeconds)} — {isSignedIn ? "not saved to your account yet." : "guest work isn't saved."}
              </p>
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  onClick={keepWorking}
                  disabled={keepingWorking}
                  className="rounded-full bg-accent text-accent-ink font-semibold transition-transform hover:scale-[1.03] active:scale-95 disabled:hover:scale-100 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  {keepingWorking ? "Refreshing…" : "Keep working"}
                </button>
                <button
                  type="button"
                  onClick={saveOrSignUp}
                  disabled={boilerplateJobActive || savingProject}
                  title={boilerplateJobActive ? "Wait for boilerplate generation to finish first" : undefined}
                  className="text-xs font-medium underline disabled:no-underline disabled:opacity-50"
                >
                  {isSignedIn ? (savingProject ? "Saving…" : "Save to my account") : "Sign up to save"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="text-xs text-muted">
                <p>
                  {isSignedIn ? (
                    <>Not saved yet.{" "}</>
                  ) : (
                    <>Guest session · not saved.{" "}</>
                  )}
                  <button
                    type="button"
                    onClick={saveOrSignUp}
                    disabled={boilerplateJobActive || savingProject}
                    title={boilerplateJobActive ? "Wait for boilerplate generation to finish first" : undefined}
                    className="font-medium text-accent underline underline-offset-2 disabled:no-underline disabled:opacity-50"
                  >
                    {isSignedIn ? (savingProject ? "Saving…" : "Save to my account") : "Sign up to save"}
                  </button>
                  {boilerplateJobActive && ` (after boilerplate finishes)`}
                </p>
                {saveProjectError && <p className="mt-1 text-red-400">{saveProjectError}</p>}
              </div>
              <button
                type="button"
                onClick={requestStartOver}
                className="group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent"
              >
                Start over
                <svg
                  viewBox="0 0 24 24"
                  className="h-3 w-3 transition-transform duration-500 group-hover:-rotate-180"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                  <polyline points="21 3 21 9 15 9" />
                </svg>
              </button>
            </div>
          )}

          <div>
            <Kicker>Your project</Kicker>
            <h1 className="mt-4 line-clamp-3 font-display text-5xl uppercase leading-[0.9] sm:text-7xl">{projectTitle}</h1>
            <div className="mt-8 inline-flex rounded-full border border-line p-1 font-mono text-[11px] uppercase tracking-[0.2em]" role="group" aria-label="Project step">
              {(["prd", "stack"] as const).map((slide) => {
                const active = activeSlide === slide;
                return (
                  <button
                    key={slide}
                    type="button"
                    onClick={() => setActiveSlide(slide)}
                    aria-pressed={active}
                    className="relative rounded-full px-4 py-2"
                  >
                    {active && (
                      <motion.span
                        layoutId="active-slide-pill"
                        className="absolute inset-0 rounded-full bg-accent"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className={`relative transition-colors ${active ? "text-accent-ink" : "text-muted hover:text-foreground"}`}>
                      {slide === "prd" ? "01 Spec" : "02 Stack & code"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative overflow-hidden">
            <div
              className={`space-y-6 transition-transform duration-500 ease-in-out ${
                activeSlide === "prd" ? "translate-x-0" : "absolute inset-0 w-full -translate-x-full"
              }`}
              inert={activeSlide !== "prd"}
            >
          {state.lowConfidence && (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
              Thin idea — review this spec closely before picking a stack.
            </div>
          )}
          {sectionError && (
            <p className="text-sm text-red-400" role="status" aria-live="polite">
              {sectionError}
            </p>
          )}

          <div>
            <h2 className="font-display text-4xl uppercase leading-none">The spec</h2>
            <div
              className={`mt-3 flex w-full flex-col sm:flex-row overflow-hidden rounded-2xl border border-line bg-surface transition-all duration-300 ease-in-out ${
                selectedSection ? "sm:w-full" : "sm:w-72"
              }`}
            >
              <div
                className={`w-full sm:w-72 shrink-0 divide-y divide-line ${
                  selectedSection ? "border-b sm:border-b-0 sm:border-r border-line" : ""
                }`}
              >
                {state.sections.map((section, index) => {
                  const isSelected = selectedSectionKey === section.key;
                  return (
                    <button
                      key={section.key}
                      type="button"
                      onClick={() => selectSection(section.key)}
                      aria-pressed={isSelected}
                      style={{ animationDelay: `${500 + index * 70}ms` }}
                      className={`flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium transition-colors [animation:fade-in-up_0.5s_ease-out_backwards] ${
                        isSelected
                          ? "bg-accent text-accent-ink"
                          : "hover:bg-white/[0.04]"
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                          isSelected
                            ? "bg-accent-ink text-accent"
                            : "bg-accent text-accent-ink"
                        }`}
                      >
                        {getSectionIcon(section.key)}
                      </span>
                      <span>{section.title}</span>
                    </button>
                  );
                })}
              </div>

              {/* Mount is deferred until showSelectedPanel flips true (see the effect above) — by
                  then the box's own width transition has essentially finished, so this never lays
                  out, even briefly, at a squeezed width. */}
              {selectedSection && showSelectedPanel && (
                <div
                  key={selectedSection.key}
                  className="w-full flex-1 min-w-0 p-4 [animation:fade-in-up_0.2s_ease-out]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-sm font-semibold">{selectedSection.title}</h2>
                    {!isEditingSelected && (
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          onClick={() => startEdit(selectedSection)}
                          disabled={anySectionBusy}
                          className="rounded-full border border-line px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => regenerateSection(selectedSection.key)}
                          disabled={anySectionBusy}
                          className="rounded-full border border-line px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                        >
                          {isSelectedBusy ? "Regenerating…" : "Regenerate"}
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditingSelected ? (
                    <div className="mt-2 space-y-2">
                      <label htmlFor={`${sectionEditId}-${selectedSection.key}`} className="sr-only">
                        Edit {selectedSection.title}
                      </label>
                      <textarea
                        id={`${sectionEditId}-${selectedSection.key}`}
                        value={draftContent}
                        onChange={(e) => setDraftContent(e.target.value)}
                        rows={4}
                        disabled={isSelectedBusy}
                        className="w-full rounded-xl border border-line bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => saveEdit(selectedSection.key)}
                          disabled={isSelectedBusy || !draftContent.trim()}
                          className="rounded-full bg-accent text-accent-ink font-semibold transition-transform hover:scale-[1.03] active:scale-95 disabled:hover:scale-100 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                        >
                          {isSelectedBusy ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={isSelectedBusy}
                          className="rounded-full border border-line transition-colors hover:border-accent hover:text-accent px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted">
                      {isSelectedBusy ? "Regenerating…" : selectedSection.content}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveSlide("stack")}
            className="group inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-ink transition-transform hover:scale-[1.03] active:scale-95"
          >
            Next: the stack
            <span className="transition-transform group-hover:translate-x-1" aria-hidden="true">
              →
            </span>
          </button>
            </div>

            <div
              className={`space-y-6 transition-transform duration-500 ease-in-out ${
                activeSlide === "stack" ? "translate-x-0" : "absolute inset-0 w-full translate-x-full"
              }`}
              inert={activeSlide !== "stack"}
            >
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-4xl uppercase leading-none">The stack</h2>
              {stack && (
                <button
                  type="button"
                  onClick={generateStack}
                  disabled={stackLoading}
                  className="text-xs font-medium text-muted hover:underline disabled:opacity-50"
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
            <div className="mt-3 rounded-2xl border border-line bg-surface p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
                Tune the pick
              </p>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor={platformId} className="block text-xs font-medium text-muted">
                    Platform
                  </label>
                  <select
                    id={platformId}
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value as PlatformHint | "")}
                    disabled={stackLoading}
                    className="mt-1 w-full rounded-xl border border-line bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="" className={OPTION_CLASS}>No preference</option>
                    <option value="web" className={OPTION_CLASS}>Web</option>
                    <option value="mobile" className={OPTION_CLASS}>Mobile</option>
                  </select>
                </div>
                <div>
                  <label htmlFor={scopeId} className="block text-xs font-medium text-muted">
                    Scope
                  </label>
                  <select
                    id={scopeId}
                    value={scopeSize}
                    onChange={(e) => setScopeSize(e.target.value as ScopeSizeHint | "")}
                    disabled={stackLoading}
                    className="mt-1 w-full rounded-xl border border-line bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    <option value="" className={OPTION_CLASS}>No preference</option>
                    <option value="weekend" className={OPTION_CLASS}>Weekend project</option>
                    <option value="mvp" className={OPTION_CLASS}>MVP</option>
                    <option value="production" className={OPTION_CLASS}>Production app</option>
                  </select>
                </div>
                <div>
                  <label htmlFor={stackId} className="block text-xs font-medium text-muted">
                    Stacks you know
                  </label>
                  <input
                    id={stackId}
                    type="text"
                    value={stackFamiliarity}
                    onChange={(e) => setStackFamiliarity(e.target.value)}
                    disabled={stackLoading}
                    placeholder="e.g. FastAPI, Vue"
                    className="mt-1 w-full rounded-xl border border-line bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
              </div>
            </div>

            {stackStale && stack && (
              <div className="mt-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
                Spec changed since this stack was picked.
              </div>
            )}

            {stackError && (
              <p className="mt-2 text-sm text-red-400" role="status" aria-live="polite">
                {stackError}
              </p>
            )}

            {!stack && (
              <button
                type="button"
                onClick={generateStack}
                disabled={stackLoading}
                className="mt-3 rounded-full bg-accent text-accent-ink font-semibold transition-transform hover:scale-[1.03] active:scale-95 disabled:hover:scale-100 px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {stackLoading ? "Generating…" : "Generate Tech Stack"}
              </button>
            )}

            {stack && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {STACK_CATEGORIES.map(({ key, label }, index) => {
                  const piece = stack[key];
                  const isOverriding = overridingCategory === key;

                  return (
                    <div
                      key={key}
                      className="rounded-2xl border border-line bg-surface p-4 [animation:fade-in-up_0.3s_ease-out_backwards]"
                      style={{ animationDelay: `${index * 60}ms` }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">
                            {getStackCategoryIcon(key)}
                          </span>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                            {label}
                          </h3>
                        </div>
                        {!isOverriding && (
                          <button
                            type="button"
                            onClick={() => startOverride(key, piece.choice)}
                            disabled={stackLoading}
                            className="rounded-full border border-line px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                          >
                            Override
                          </button>
                        )}
                      </div>

                      {isOverriding ? (
                        <div className="mt-2 space-y-2">
                          <label htmlFor={`${stackOverrideId}-${key}`} className="sr-only">
                            Override {label}
                          </label>
                          {/* A select, not free text: the server only accepts these exact choices,
                              so a typed-in value could only ever fail with "Invalid request". */}
                          <select
                            id={`${stackOverrideId}-${key}`}
                            value={overrideChoice}
                            onChange={(e) => setOverrideChoice(e.target.value)}
                            disabled={stackLoading}
                            className="w-full rounded-xl border border-line bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                          >
                            {STACK_ALTERNATIVES[key].map((alt) => (
                              <option key={alt} value={alt} className={OPTION_CLASS}>
                                {alt}
                              </option>
                            ))}
                          </select>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => saveOverride(key)}
                              disabled={stackLoading || !overrideChoice.trim()}
                              className="rounded-full bg-accent text-accent-ink font-semibold transition-transform hover:scale-[1.03] active:scale-95 disabled:hover:scale-100 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                            >
                              {stackLoading ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelOverride}
                              disabled={stackLoading}
                              className="rounded-full border border-line transition-colors hover:border-accent hover:text-accent px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="mt-2 text-sm font-medium">{piece.choice}</p>
                          <p className="mt-0.5 text-sm text-muted">{piece.rationale}</p>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {stack && (
            <div className="border-t border-line pt-8">
              <h2 className="font-display text-4xl uppercase leading-none">The code</h2>
              {generatedCode && (
                <div className="mt-3 text-sm">
                  <p className="text-muted">
                    Generates <span className="font-medium text-foreground">{generatedCode.summary}</span>
                  </p>
                  {generatedCode.notReflected.length > 0 && (
                    <p className="mt-1 text-amber-200">
                      Not in the generated code yet: {generatedCode.notReflected.join(", ")}.
                    </p>
                  )}
                </div>
              )}

              {boilerplateStale && boilerplateJobState === "succeeded" && (
                <div className="mt-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
                  Stack changed since this was generated.
                </div>
              )}

              {boilerplateError && (
                <p className="mt-2 text-sm text-red-400" role="status" aria-live="polite">
                  {boilerplateError}
                </p>
              )}

              {/* Keyed on the collapsed phase (not the raw job state) so pending->running doesn't
                  restart the slide-in mid-progress-bar — only a genuine phase change (idle ->
                  generating -> done/failed) re-triggers it, since each of those swaps in visibly
                  different content that was otherwise just cutting into view with no transition. */}
              <div key={boilerplateJobActive ? "active" : boilerplateJobState} className="[animation:slide-in-right_0.3s_ease-out]">
                {prompt && (
                  <p className="mt-1 truncate text-sm text-muted" title={prompt}>
                    {prompt}
                  </p>
                )}

                {boilerplateJobState === "idle" && (
                  <button
                    type="button"
                    onClick={generateBoilerplate}
                    className="mt-3 rounded-full bg-accent text-accent-ink font-semibold transition-transform hover:scale-[1.03] active:scale-95 disabled:hover:scale-100 px-4 py-2 text-sm font-medium"
                  >
                    Generate Boilerplate
                  </button>
                )}

                {boilerplateJobActive && (
                  <div className="mt-3">
                    <div className="h-1.5 w-full rounded-full bg-line overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all duration-700"
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
                    className="mt-3 rounded-full border border-line transition-colors hover:border-accent hover:text-accent px-4 py-2 text-sm font-medium"
                  >
                    Retry
                  </button>
                )}

                {boilerplateJobState === "succeeded" && (
                  <div className="mt-3 flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <p
                        className={
                          boilerplateUnvalidated
                            ? "min-w-0 text-sm text-amber-300"
                            : "min-w-0 text-sm text-accent"
                        }
                      >
                        {boilerplateUnvalidated
                          ? "Generated — unchecked (no Python found). Review before running."
                          : boilerplateWebContainerCompatible === false
                            ? "Generated · Python syntax checked."
                            : boilerplateBuildVerified
                              ? "Generated · verified running in Live Preview."
                              : "Generated · syntax-checked. Open Live Preview to run it."}
                      </p>
                      <a
                        href="/api/boilerplate/download"
                        className="shrink-0 whitespace-nowrap rounded-full bg-accent text-accent-ink font-semibold transition-transform hover:scale-[1.03] active:scale-95 disabled:hover:scale-100 px-4 py-2 text-sm font-medium"
                      >
                        Download zip
                      </a>
                      {boilerplateJobId && (
                        <a
                          href={`/preview/${boilerplateJobId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 whitespace-nowrap rounded-full border border-line transition-colors hover:border-accent hover:text-accent px-4 py-2 text-sm font-medium"
                        >
                          {boilerplateWebContainerCompatible === false ? "View files" : "Live Preview"}
                        </a>
                      )}
                    </div>
                    {boilerplateWebContainerCompatible === false && (
                      <p className="text-xs text-muted">
                        Live preview isn&apos;t available for this stack — download the zip and run it locally (see
                        the included README for the exact command).
                      </p>
                    )}
                    {boilerplateStale && (
                      <button
                        type="button"
                        onClick={generateBoilerplate}
                        className="text-xs font-medium text-muted hover:underline"
                      >
                        Regenerate
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
            </div>
          </div>

        </div>
      )}

      {state.phase === "converted" && (
        <div className="mt-2">
          <div className="flex items-center gap-4">
            <motion.span
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.3 }}
              className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent text-accent-ink"
            >
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <motion.polyline
                  points="4 12 9 17 20 6"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, delay: 0.6, ease: EASE }}
                />
              </svg>
            </motion.span>
            <h1 className="font-display text-7xl uppercase leading-none sm:text-8xl">Saved.</h1>
          </div>

          <p className="mt-8 max-w-2xl text-lg text-muted">{state.prompt}</p>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {state.sections.length > 0 && (
              <div className="rounded-2xl border border-line bg-surface p-6">
                <Kicker>Spec</Kicker>
                <ul className="mt-4 space-y-2 text-sm">
                  {state.sections.map((section, i) => (
                    <li
                      key={section.key}
                      className="flex items-center gap-3 [animation:fade-in-up_0.5s_ease-out_backwards]"
                      style={{ animationDelay: `${400 + i * 60}ms` }}
                    >
                      <span className="text-accent">{getSectionIcon(section.key)}</span>
                      {section.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {state.stack && (
              <div className="rounded-2xl border border-line bg-surface p-6">
                <Kicker>Stack</Kicker>
                <ul className="mt-4 space-y-2 text-sm">
                  {STACK_CATEGORIES.map(({ key, label }, i) => (
                    <li
                      key={key}
                      className="flex items-center justify-between gap-3 [animation:fade-in-up_0.5s_ease-out_backwards]"
                      style={{ animationDelay: `${400 + i * 60}ms` }}
                    >
                      <span className="text-muted">{label}</span>
                      <span className="font-medium">{state.stack![key].choice}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {state.hasBoilerplate && (
            <p className="mt-6 text-sm text-muted">
              Boilerplate saved too. With GitHub auto-push on in{" "}
              <a href="/account" className="text-accent underline underline-offset-2">
                your account
              </a>
              , its repo is being created now.
            </p>
          )}

          <button
            type="button"
            onClick={startOver}
            className="group mt-10 inline-flex items-center gap-2 rounded-full bg-accent px-7 py-4 text-base font-semibold text-accent-ink transition-transform hover:scale-[1.03] active:scale-95"
          >
            Roll a new one
            <span className="transition-transform group-hover:translate-x-1" aria-hidden="true">
              →
            </span>
          </button>
        </div>
      )}
          </motion.div>
        </main>
      )}

      <HowItWorks />

      <CliSection />

      <MobileSection />

      <CapabilitiesSection />

      <Faq />

      <Footer />

      <IdeaRoller
        open={rollerOpen}
        loading={ideaLoading}
        idea={idea}
        drawNumber={drawNumber}
        error={ideaError}
        building={isSubmitting}
        buildError={state.phase === "error" ? state.message : null}
        onReroll={generateIdea}
        onBuild={startPrdFromIdea}
        onClose={closeRoller}
        onWriteOwn={() => {
          setRollerOpen(false);
          setShowManualForm(true);
        }}
      />

      {showSignInModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSignInModal(false);
          }}
        >
          <div
            ref={signInModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-in-modal-title"
            tabIndex={-1}
            className="w-full max-w-sm rounded-3xl border border-line bg-surface p-6 shadow-2xl outline-none"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id="sign-in-modal-title" className="text-lg font-semibold">
                Sign in
              </h2>
              <button
                type="button"
                onClick={() => setShowSignInModal(false)}
                aria-label="Close"
                className="rounded-full p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-accent"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            </div>

            <p className="mt-2 text-sm text-muted">
              Save projects past your guest session, push generated code to GitHub, and get a higher generation
              limit.
            </p>

            <button
              type="button"
              onClick={handleSignUpClick}
              disabled={boilerplateJobActive}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-semibold text-accent-ink transition-transform hover:scale-[1.02] disabled:opacity-50"
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

      {showExitConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowExitConfirm(false);
          }}
        >
          <div
            ref={exitConfirmRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="exit-confirm-title"
            tabIndex={-1}
            className="w-full max-w-sm rounded-3xl border border-line bg-surface p-6 shadow-2xl outline-none"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id="exit-confirm-title" className="text-lg font-semibold">
                {isSignedIn ? "Save this project before starting over?" : "Sign up to save before starting over?"}
              </h2>
              <button
                type="button"
                onClick={() => setShowExitConfirm(false)}
                disabled={exiting}
                aria-label="Close"
                className="shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-accent disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            </div>

            {boilerplateJobActive && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Boilerplate is still generating — saving isn&apos;t available until it finishes.
              </p>
            )}
            {saveProjectError && (
              <p className="mt-2 text-xs text-red-400">{saveProjectError}</p>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveOrSignUp}
                disabled={boilerplateJobActive || savingProject}
                className="rounded-full border border-line transition-colors hover:border-accent hover:text-accent px-3.5 py-2 text-sm font-medium disabled:opacity-50"
              >
                {isSignedIn ? (savingProject ? "Saving…" : "Save to my account") : "Sign up to save"}
              </button>
              <button
                type="button"
                onClick={discardAndStartOver}
                disabled={exiting}
                className="rounded-full bg-accent text-accent-ink font-semibold transition-transform hover:scale-[1.03] active:scale-95 disabled:hover:scale-100 px-3.5 py-2 text-sm font-medium disabled:opacity-50"
              >
                {exiting ? "Discarding…" : "Discard & start over"}
              </button>
              <button
                type="button"
                onClick={() => setShowExitConfirm(false)}
                disabled={exiting}
                className="text-sm font-medium text-muted hover:underline disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showManualForm && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowManualForm(false);
          }}
        >
          <div
            ref={manualFormRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-form-title"
            tabIndex={-1}
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line bg-surface p-6 shadow-2xl outline-none [animation:slide-up-sheet_0.3s_ease-out]"
          >
            <div className="relative">
              <h2 id="manual-form-title" className="text-center text-lg font-semibold">
                Describe your own idea
              </h2>
              <button
                type="button"
                onClick={() => setShowManualForm(false)}
                aria-label="Close"
                className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-accent"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4" aria-busy={isSubmitting}>
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
                  className="mt-1 w-full rounded-xl border border-line bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor={platformId} className="block text-sm font-medium">
                    Platform <span className="text-muted font-normal">(optional)</span>
                  </label>
                  <select
                    id={platformId}
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value as PlatformHint | "")}
                    disabled={isSubmitting}
                    className="mt-1 w-full rounded-xl border border-line bg-background px-3 py-2 text-sm"
                  >
                    <option value="" className={OPTION_CLASS}>No preference</option>
                    <option value="web" className={OPTION_CLASS}>Web</option>
                    <option value="mobile" className={OPTION_CLASS}>Mobile</option>
                  </select>
                </div>

                <div>
                  <label htmlFor={scopeId} className="block text-sm font-medium">
                    Scope <span className="text-muted font-normal">(optional)</span>
                  </label>
                  <select
                    id={scopeId}
                    value={scopeSize}
                    onChange={(e) => setScopeSize(e.target.value as ScopeSizeHint | "")}
                    disabled={isSubmitting}
                    className="mt-1 w-full rounded-xl border border-line bg-background px-3 py-2 text-sm"
                  >
                    <option value="" className={OPTION_CLASS}>No preference</option>
                    <option value="weekend" className={OPTION_CLASS}>Weekend project</option>
                    <option value="mvp" className={OPTION_CLASS}>MVP</option>
                    <option value="production" className={OPTION_CLASS}>Production app</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor={stackId} className="block text-sm font-medium">
                  Stacks you already know <span className="text-muted font-normal">(optional)</span>
                </label>
                <input
                  id={stackId}
                  type="text"
                  value={stackFamiliarity}
                  onChange={(e) => setStackFamiliarity(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="e.g. React, Postgres"
                  className="mt-1 w-full rounded-xl border border-line bg-background px-3 py-2 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting || !prompt.trim()}
                className="rounded-full bg-accent text-accent-ink font-semibold transition-transform hover:scale-[1.03] active:scale-95 disabled:hover:scale-100 px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    Generating
                    <LoadingDots />
                  </>
                ) : (
                  "Generate PRD"
                )}
              </button>

              {/* The hero's own status paragraph is behind this modal's backdrop and wouldn't be
                  visible — a submit error needs its own copy here instead. */}
              {state.phase === "error" && (
                <p className="text-sm text-red-400" role="status" aria-live="polite">
                  {state.message}
                </p>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
