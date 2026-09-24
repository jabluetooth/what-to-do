"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { RandomIdea } from "@/lib/types";
import { DECOY_TITLES, posterFontSize } from "@/lib/decoyIdeas";
import { useModalDialog } from "@/lib/useModalDialog";
import { EASE } from "@/components/fx/Reveal";

/** The reel keeps spinning at least this long even when the API answers faster — a roll that
 *  lands instantly doesn't read as a roll at all. */
const MIN_SPIN_MS = 1500;
const REEL_TICK_MS = 80;
const REEL_FONT_SIZE = posterFontSize(DECOY_TITLES.reduce((a, b) => (b.length > a.length ? b : a)));

interface IdeaRollerProps {
  open: boolean;
  /** The random-idea request is in flight. */
  loading: boolean;
  idea: RandomIdea | null;
  /** Bumped once per roll — replays the spin and the landing even when the same idea repeats. */
  drawNumber: number;
  error: string | null;
  /** The PRD request for the landed idea is in flight. */
  building: boolean;
  buildError: string | null;
  onReroll: () => void;
  onBuild: () => void;
  onClose: () => void;
  onWriteOwn: () => void;
}

/**
 * Full-screen "draw": the whole viewport becomes a slot reel of poster-sized idea titles, then
 * floods lime and lands the real idea word by word. Stays open (in a building state) while the
 * PRD for the landed idea is generated — the page closes it once that PRD arrives.
 */
export default function IdeaRoller(props: IdeaRollerProps) {
  const { open, onClose } = props;
  const dialogRef = useModalDialog(open, onClose);

  // Lock the page behind the overlay so a wheel/touch scroll doesn't move it underneath.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="roller"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Random app idea"
          tabIndex={-1}
          className="fixed inset-0 z-[70] overflow-hidden bg-background outline-none"
          initial={{ clipPath: "inset(100% 0% 0% 0%)" }}
          animate={{ clipPath: "inset(0% 0% 0% 0%)" }}
          exit={{ clipPath: "inset(0% 0% 100% 0%)" }}
          transition={{ duration: 0.75, ease: EASE }}
        >
          <RollerStage {...props} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RollerStage({
  loading,
  idea,
  drawNumber,
  error,
  building,
  buildError,
  onReroll,
  onBuild,
  onClose,
  onWriteOwn,
}: IdeaRollerProps) {
  const reducedMotion = useReducedMotion();
  // Opened mid-request (a fresh roll) → start unsettled so the minimum spin applies to this draw
  // too; opened with nothing in flight (reopening the last idea) → land straight away.
  const [settledDraw, setSettledDraw] = useState(() => (loading ? -1 : drawNumber));
  const [tick, setTick] = useState(0);

  // The minimum spin window for this draw — only resolved from inside the timer, never
  // synchronously in the effect body.
  useEffect(() => {
    const id = setTimeout(() => setSettledDraw(drawNumber), reducedMotion ? 0 : MIN_SPIN_MS);
    return () => clearTimeout(id);
  }, [drawNumber, reducedMotion]);

  const spinning = loading || settledDraw !== drawNumber;
  const landed = !spinning && !error && idea !== null;

  useEffect(() => {
    if (!spinning || reducedMotion) return;
    const id = setInterval(() => setTick((t) => t + 1), REEL_TICK_MS);
    return () => clearInterval(id);
  }, [spinning, reducedMotion]);

  // R rerolls, Enter on the bare dialog builds — buttons keep their own native Enter/Space.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === "r" || e.key === "R") && !spinning && !building) {
        e.preventDefault();
        onReroll();
      } else if (e.key === "Enter" && landed && !building && (e.target as HTMLElement | null)?.getAttribute("role") === "dialog") {
        onBuild();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [spinning, landed, building, onReroll, onBuild]);

  const decoy = DECOY_TITLES[(tick + drawNumber * 7) % DECOY_TITLES.length];
  const drawLabel = `Nº ${String(drawNumber).padStart(4, "0")}`;
  const ink = landed ? "text-accent-ink" : "text-foreground";

  return (
    <>
      {/* Speed streaks behind the spinning reel. */}
      {spinning && !reducedMotion && (
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.07] [animation:streak_0.4s_linear_infinite]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, transparent 0 46px, var(--foreground) 46px 47px), repeating-linear-gradient(180deg, transparent 0 140px, var(--accent) 140px 143px)",
          }}
        />
      )}

      {/* The lime flood that marks the moment an idea lands. */}
      <AnimatePresence>
        {landed && (
          <motion.div
            key={`flood-${drawNumber}`}
            aria-hidden="true"
            className="absolute inset-0 bg-accent"
            initial={{ clipPath: "circle(0% at 50% 45%)" }}
            animate={{ clipPath: "circle(150% at 50% 45%)" }}
            exit={{ clipPath: "circle(0% at 50% 45%)" }}
            transition={{ duration: 0.8, ease: EASE }}
          />
        )}
      </AnimatePresence>

      <p className="sr-only" role="status" aria-live="polite">
        {spinning && "Rolling an idea…"}
        {landed && idea && `${idea.title}, ${idea.targetUser}. ${idea.description}`}
        {building && "Writing the PRD…"}
      </p>

      <div className={`relative z-10 flex h-full flex-col px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] sm:px-10 sm:pb-8 sm:pt-8 transition-colors duration-500 ${ink}`}>
        <header className="flex items-center justify-between gap-4 font-mono text-[11px] uppercase tracking-[0.25em]">
          <span className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${landed ? "bg-accent-ink" : "bg-accent"} ${spinning ? "[animation:loading-dot_0.6s_ease-in-out_infinite]" : ""}`}
              aria-hidden="true"
            />
            {spinning ? "Rolling" : "Draw"} {drawLabel}
          </span>
          {landed && idea && (
            <motion.span
              key={`tag-${drawNumber}`}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.5, ease: EASE }}
              className="hidden rounded-full border border-current px-3 py-1 sm:inline-block"
            >
              {idea.platformTag}
            </motion.span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="group inline-flex items-center gap-2 rounded-full px-2 py-1 uppercase tracking-[0.25em] hover:opacity-70"
          >
            <span className="hidden sm:inline">Esc</span>
            <svg viewBox="0 0 24 24" className="h-5 w-5 transition-transform duration-300 group-hover:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
          {spinning && (
            // The guide lines are the box's own borders, and text-box-trim cuts the text box down
            // to cap-height-to-baseline, so the word sits exactly centred between them. One fixed
            // size for every reel word keeps the lines from jumping as words change.
            <div
              aria-hidden="true"
              className="flex w-full items-center justify-center overflow-hidden border-y border-accent/40 py-[0.22em]"
              style={{ fontSize: REEL_FONT_SIZE }}
            >
              {reducedMotion ? (
                <p className="font-display uppercase leading-none text-accent [text-box:trim-both_cap_alphabetic]">Rolling…</p>
              ) : (
                <motion.p
                  key={tick}
                  // Stretch + blur around its own centre (no y travel): a word is almost never at
                  // rest at this tick rate, so any vertical slide reads as the reel sitting low.
                  initial={{ scaleY: 1.35, opacity: 0.25, filter: "blur(10px)" }}
                  animate={{ scaleY: 1, opacity: 1, filter: "blur(0px)" }}
                  transition={{ duration: 0.07, ease: "linear" }}
                  className="whitespace-nowrap font-display uppercase leading-none text-accent [text-box:trim-both_cap_alphabetic]"
                >
                  {decoy}
                </motion.p>
              )}
            </div>
          )}

          {!spinning && error && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease: EASE }}>
              <p className="font-display text-[18vw] uppercase leading-[0.85] text-foreground sm:text-[12vw]">No dice.</p>
              <p className="mt-4 text-muted">{error}</p>
            </motion.div>
          )}

          {landed && idea && <LandedIdea idea={idea} drawNumber={drawNumber} building={building} />}
        </div>

        <footer className="flex min-h-[4.5rem] flex-col items-center gap-4">
          {landed && !building && (
            <motion.div
              key={`actions-${drawNumber}`}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.75, duration: 0.6, ease: EASE }}
              className="flex flex-wrap items-center justify-center gap-3"
            >
              <button
                type="button"
                onClick={onBuild}
                className="group inline-flex items-center gap-3 rounded-full bg-accent-ink px-7 py-4 text-base font-semibold text-accent transition-transform hover:scale-[1.04] active:scale-95"
              >
                Build this
                <span className="inline-block transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true">
                  →
                </span>
              </button>
              <button
                type="button"
                onClick={onReroll}
                className="group inline-flex items-center gap-2 rounded-full border-2 border-accent-ink px-6 py-[0.875rem] text-base font-semibold transition-colors hover:bg-accent-ink hover:text-accent"
              >
                <DiceIcon className="h-5 w-5 transition-transform duration-500 group-hover:rotate-[360deg]" />
                Roll again
              </button>
              <button type="button" onClick={onWriteOwn} className="px-3 py-2 text-sm font-medium underline decoration-2 underline-offset-4 hover:opacity-70">
                Write my own
              </button>
            </motion.div>
          )}

          {landed && building && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-md text-center">
              <p className="font-mono text-xs uppercase tracking-[0.25em]">Writing the spec</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-accent-ink/15">
                <div className="h-full w-full origin-left rounded-full bg-accent-ink [animation:indeterminate_1.3s_ease-in-out_infinite]" />
              </div>
            </motion.div>
          )}

          {landed && buildError && !building && (
            <p className="text-sm font-medium" role="alert">
              {buildError}
            </p>
          )}

          {!spinning && error && (
            <button
              type="button"
              onClick={onReroll}
              className="inline-flex items-center gap-2 rounded-full bg-accent px-7 py-4 text-base font-semibold text-accent-ink hover:scale-[1.04] transition-transform"
            >
              <DiceIcon className="h-5 w-5" />
              Try again
            </button>
          )}

          {landed && !building && (
            <p className="hidden font-mono text-[10px] uppercase tracking-[0.25em] opacity-60 sm:block" aria-hidden="true">
              R — reroll · Esc — close
            </p>
          )}
        </footer>
      </div>
    </>
  );
}

function LandedIdea({ idea, drawNumber, building }: { idea: RandomIdea; drawNumber: number; building: boolean }) {
  const words = idea.title.split(/\s+/);
  return (
    <div key={drawNumber} className="flex w-full flex-col items-center">
      <h2
        className={`max-w-[95vw] font-display uppercase leading-[0.92] tracking-tight transition-opacity duration-500 ${building ? "opacity-80" : ""}`}
        style={{ fontSize: posterFontSize(idea.title) }}
      >
        {words.map((word, i) => (
          // Spacing is a margin, not a text space — a trailing space inside an inline-block is
          // collapsed at its edge, which glued every word together. The mask gets extra padding
          // (cancelled by negative margins) so it clips only the rise-in, never the glyph tops.
          <span key={`${word}-${i}`} className="-my-[0.12em] mx-[0.08em] inline-block overflow-hidden px-[0.04em] py-[0.12em] align-bottom">
            <motion.span
              className="inline-block"
              initial={{ y: "105%", rotate: 8, scale: 0.9 }}
              animate={{ y: "0%", rotate: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 240, damping: 17, delay: 0.15 + i * 0.07 }}
            >
              {word}
            </motion.span>
          </span>
        ))}
      </h2>
      <motion.p
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.6, ease: EASE }}
        className="mt-5 max-w-3xl text-balance text-xl font-semibold sm:text-3xl"
      >
        {idea.targetUser}
      </motion.p>
      <motion.p
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 0.75, y: 0 }}
        transition={{ delay: 0.6, duration: 0.6, ease: EASE }}
        className="mt-3 line-clamp-4 max-w-2xl text-pretty text-base sm:text-lg"
      >
        {idea.description}
      </motion.p>
    </div>
  );
}

export function DiceIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
