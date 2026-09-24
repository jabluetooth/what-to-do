"use client";

import { motion, useMotionValue, useSpring } from "framer-motion";
import type { RandomIdea } from "@/lib/types";
import { DECOY_TITLES } from "@/lib/decoyIdeas";
import { EASE } from "@/components/fx/Reveal";
import { DiceIcon } from "@/components/IdeaRoller";

const HEADLINE = ["WHAT", "TO", "DO"];
const PIPELINE = ["Idea", "PRD", "Stack", "Code"];

interface HeroProps {
  onRoll: () => void;
  onWriteOwn: () => void;
  /** The last landed idea, if the roller was closed without building it. */
  lastIdea: RandomIdea | null;
  onReopen: () => void;
  disabled: boolean;
  error: string | null;
}

export default function Hero({ onRoll, onWriteOwn, lastIdea, onReopen, disabled, error }: HeroProps) {
  return (
    <section className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-4 pb-16 pt-28">
      <MarqueeBackdrop />

      {/* Soft lime glow that anchors the roll button. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[62%] h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-[120px]"
      />

      <div className="relative z-10 flex flex-col items-center text-center">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
          className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted"
        >
          Stuck on what to build?
        </motion.p>

        <h1 className="mt-4 flex items-end font-display uppercase leading-[0.82] tracking-tight" style={{ fontSize: "clamp(3.5rem, 15vw, 15rem)" }}>
          <span className="sr-only">What to do?</span>
          {HEADLINE.map((word, i) => (
            <span key={word} aria-hidden="true" className={`inline-block overflow-hidden ${i < HEADLINE.length - 1 ? "pr-[0.12em]" : "pr-[0.03em]"}`}>
              <motion.span
                className="inline-block"
                initial={{ y: "110%" }}
                animate={{ y: "0%" }}
                transition={{ duration: 1, ease: EASE, delay: 0.15 + i * 0.1 }}
              >
                {word}
              </motion.span>
            </span>
          ))}
          <motion.span
            aria-hidden="true"
            className="inline-block origin-bottom text-accent"
            initial={{ scale: 0, rotate: -40 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 12, delay: 0.6 }}
          >
            <span className="inline-block origin-bottom [animation:wobble_2.4s_ease-in-out_3s_infinite]">?</span>
          </motion.span>
        </h1>

        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 16, delay: 0.75 }}
          className="mt-10"
        >
          <RollButton onClick={onRoll} disabled={disabled} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 1.1 }}
          className="mt-8 flex flex-col items-center gap-3"
        >
          {lastIdea && (
            <button
              type="button"
              onClick={onReopen}
              className="group inline-flex max-w-[90vw] items-center gap-3 rounded-full border border-line bg-surface/80 py-1.5 pl-1.5 pr-4 text-sm backdrop-blur transition-colors hover:border-accent/60"
            >
              <span className="rounded-full bg-accent px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-accent-ink">Last</span>
              <span className="truncate font-medium">{lastIdea.title}</span>
              <span className="text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true">
                ↗
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={onWriteOwn}
            className="text-sm text-muted underline decoration-line underline-offset-4 transition-colors hover:text-foreground hover:decoration-accent"
          >
            or write your own
          </button>
          {error && (
            <p className="text-sm text-red-400" role="status" aria-live="polite">
              {error}
            </p>
          )}
        </motion.div>
      </div>

      <PipelineRail />
    </section>
  );
}

/** Big circular lime button with a slowly orbiting ring of text and a magnetic pull toward the
 *  cursor — the one control on the landing screen that matters. */
function RollButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 220, damping: 15 });
  const springY = useSpring(y, { stiffness: 220, damping: 15 });

  function handleMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.pointerType !== "mouse") return;
    const rect = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - rect.left - rect.width / 2) * 0.3);
    y.set((e.clientY - rect.top - rect.height / 2) * 0.3);
  }

  function reset() {
    x.set(0);
    y.set(0);
  }

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onPointerMove={handleMove}
      onPointerLeave={reset}
      style={{ x: springX, y: springY }}
      whileTap={{ scale: 0.9 }}
      aria-label="Roll a random app idea"
      className="group relative grid h-44 w-44 place-items-center rounded-full disabled:opacity-50 sm:h-52 sm:w-52"
    >
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full [animation:spin-slow_18s_linear_infinite] group-hover:[animation-duration:5s]" aria-hidden="true">
        <defs>
          <path id="roll-ring" d="M100,100 m-86,0 a86,86 0 1,1 172,0 a86,86 0 1,1 -172,0" />
        </defs>
        <text className="fill-foreground font-mono text-[11px] uppercase" letterSpacing="4.2">
          <textPath href="#roll-ring">Roll an idea ✦ Roll an idea ✦ Roll an idea ✦ </textPath>
        </text>
      </svg>
      <span className="relative grid h-[68%] w-[68%] place-items-center rounded-full bg-accent text-accent-ink shadow-[0_0_60px_-10px_var(--accent)] transition-transform duration-300 group-hover:scale-105">
        <span className="flex flex-col items-center">
          <DiceIcon className="h-7 w-7 transition-transform duration-700 group-hover:rotate-[360deg]" />
          <span className="mt-1 font-display text-3xl uppercase leading-none">Roll</span>
        </span>
      </span>
    </motion.button>
  );
}

/** Three rows of outlined idea titles drifting in alternating directions behind the headline. */
function MarqueeBackdrop() {
  const rows = [0, 1, 2].map((r) => {
    const titles = DECOY_TITLES.slice(r * 9).concat(DECOY_TITLES.slice(0, r * 9));
    return titles.join("  ✦  ");
  });
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex select-none flex-col justify-center gap-4 opacity-[0.09]">
      {rows.map((row, i) => (
        <div key={i} className="overflow-hidden whitespace-nowrap">
          <div
            className="inline-block font-display text-[13vw] uppercase leading-none text-transparent"
            style={{
              WebkitTextStroke: "1px var(--foreground)",
              animation: `${i % 2 ? "marquee-right" : "marquee-left"} ${90 + i * 25}s linear infinite`,
            }}
          >
            {row}  ✦  {row}  ✦{" "}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Idea → PRD → Stack → Code, with a lime pulse travelling the line. */
function PipelineRail() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: EASE, delay: 1.3 }}
      className="absolute inset-x-0 bottom-8 z-10 mx-auto w-[min(34rem,88vw)]"
    >
      <div className="relative flex items-center justify-between">
        <div className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-line" aria-hidden="true" />
        <motion.div
          aria-hidden="true"
          className="absolute top-1/2 h-px w-16 -translate-y-1/2 bg-gradient-to-r from-transparent via-accent to-transparent"
          animate={{ left: ["0%", "85%"] }}
          transition={{ duration: 2.6, ease: "easeInOut", repeat: Infinity, repeatType: "mirror" }}
        />
        {PIPELINE.map((step) => (
          <span key={step} className="relative bg-background px-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
            {step}
          </span>
        ))}
      </div>
    </motion.div>
  );
}
