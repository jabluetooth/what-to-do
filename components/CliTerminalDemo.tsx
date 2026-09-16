"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { useRevealOnScroll } from "@/lib/useRevealOnScroll";

type Tone = "command" | "success" | "muted" | undefined;

interface RenderLine {
  key: number;
  text: string;
  tone: Tone;
}

type ScriptStep =
  | { kind: "type"; text: string; tone?: Tone }
  | { kind: "line"; text: string; tone?: Tone }
  | { kind: "blank" }
  | { kind: "wait"; ms: number }
  | { kind: "spinner"; phases: { label: string; ms: number }[]; doneText: string; doneTone?: Tone };

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_FRAME_MS = 80;
const TYPE_CHAR_MS = 26;
const LOOP_PAUSE_MS = 3500;

/**
 * Mirrors packages/create-whattodo/bin/cli.js's actual run, step for step, including the one
 * place that CLI really does show a spinner (boilerplate generation) — everything else there is
 * an instant step()/success() print, so this doesn't invent spinners the real tool doesn't have.
 */
const SCRIPT: ScriptStep[] = [
  { kind: "type", text: '$ npx create-whattodo "a tool that tracks my reading list"', tone: "command" },
  { kind: "wait", ms: 400 },
  { kind: "blank" },
  { kind: "line", text: "create-whattodo — idea → PRD → stack → running project", tone: "muted" },
  { kind: "blank" },
  { kind: "line", text: "▸ Generating your PRD..." },
  { kind: "wait", ms: 650 },
  { kind: "line", text: "✔ PRD ready.", tone: "success" },
  { kind: "blank" },
  { kind: "line", text: "▸ Choosing a stack..." },
  { kind: "wait", ms: 500 },
  { kind: "line", text: "  Recommended stack", tone: "muted" },
  { kind: "line", text: "  frontend    Next.js", tone: "muted" },
  { kind: "line", text: "  backend     Next.js API Routes", tone: "muted" },
  { kind: "line", text: "  database    PostgreSQL (Neon)", tone: "muted" },
  { kind: "blank" },
  { kind: "line", text: "▸ Generating your boilerplate (this can take a minute or two)..." },
  {
    kind: "spinner",
    phases: [
      { label: "Selecting template...", ms: 500 },
      { label: "Generating routes & models... (20%)", ms: 800 },
      { label: "Generating initial UI... (45%)", ms: 800 },
      { label: "Writing project files... (60%)", ms: 500 },
      { label: "Checking syntax... (90%)", ms: 600 },
    ],
    doneText: "  ✔ Done",
    doneTone: "success",
  },
  { kind: "blank" },
  { kind: "line", text: "✔ Done — your project is ready in ./reading-list-tracker", tone: "success" },
  { kind: "blank" },
  { kind: "line", text: "Next steps:", tone: "muted" },
  { kind: "line", text: "  cd reading-list-tracker", tone: "muted" },
  { kind: "line", text: "  npm install", tone: "muted" },
  { kind: "line", text: "  npm run dev", tone: "muted" },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lineClassName(tone: Tone): string {
  switch (tone) {
    case "command":
      return "text-neutral-100 font-medium";
    case "success":
      return "text-neutral-100";
    case "muted":
      return "text-neutral-500";
    default:
      return "text-neutral-300";
  }
}

function flattenScriptStatic(): RenderLine[] {
  let key = 0;
  const out: RenderLine[] = [];
  for (const step of SCRIPT) {
    if (step.kind === "blank") out.push({ key: key++, text: "", tone: undefined });
    else if (step.kind === "type" || step.kind === "line") out.push({ key: key++, text: step.text, tone: step.tone });
    else if (step.kind === "spinner") out.push({ key: key++, text: step.doneText, tone: step.doneTone });
  }
  return out;
}

/**
 * Replays SCRIPT as a simulated live run once this component first scrolls into view: the command
 * types itself in, each line lands with roughly the delay a real network round trip would have,
 * and the spinner cycles through the same phase messages the real CLI prints during boilerplate
 * generation. Loops with a pause at the end so it doesn't go stale for a visitor who lingers.
 *
 * Under prefers-reduced-motion, skips straight to the full static final transcript — see
 * usePrefersReducedMotion's own doc comment for why the site's CSS-only reduced-motion rule can't
 * reach a setTimeout-driven loop like this one.
 */
export default function CliTerminalDemo() {
  const { ref, visible } = useRevealOnScroll<HTMLDivElement>();
  const reducedMotion = usePrefersReducedMotion();
  // Starts as the full static transcript (matching SSR exactly, so there's no hydration
  // mismatch) — real content from the first paint for no-JS/crawlers, not an empty shell that
  // only fills in once the animation happens to run. The live run below clears and rebuilds it
  // from scratch once it actually starts.
  const [lines, setLines] = useState<RenderLine[]>(() => flattenScriptStatic());
  const [current, setCurrent] = useState<RenderLine | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const keyRef = useRef(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!visible || startedRef.current) return;
    startedRef.current = true;

    // Reduced motion: `lines` is already the static transcript from useState's initializer above
    // — nothing to animate, nothing to change.
    if (reducedMotion) return;

    const signal = { cancelled: false };

    async function run() {
      while (!signal.cancelled) {
        setLines([]);
        setCurrent(null);

        for (const step of SCRIPT) {
          if (signal.cancelled) return;

          if (step.kind === "wait") {
            await sleep(step.ms);
            continue;
          }

          if (step.kind === "blank") {
            setLines((prev) => [...prev, { key: keyRef.current++, text: "", tone: undefined }]);
            continue;
          }

          if (step.kind === "line") {
            setLines((prev) => [...prev, { key: keyRef.current++, text: step.text, tone: step.tone }]);
            await sleep(120);
            continue;
          }

          if (step.kind === "type") {
            const lineKey = keyRef.current++;
            setIsTyping(true);
            for (let i = 1; i <= step.text.length; i++) {
              if (signal.cancelled) return;
              setCurrent({ key: lineKey, text: step.text.slice(0, i), tone: step.tone });
              await sleep(TYPE_CHAR_MS);
            }
            setIsTyping(false);
            setLines((prev) => [...prev, { key: lineKey, text: step.text, tone: step.tone }]);
            setCurrent(null);
            continue;
          }

          // spinner
          const lineKey = keyRef.current++;
          let frame = 0;
          for (const phase of step.phases) {
            const phaseStart = Date.now();
            while (Date.now() - phaseStart < phase.ms) {
              if (signal.cancelled) return;
              setCurrent({ key: lineKey, text: `${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} ${phase.label}`, tone: undefined });
              frame++;
              await sleep(SPINNER_FRAME_MS);
            }
          }
          setLines((prev) => [...prev, { key: lineKey, text: step.doneText, tone: step.doneTone }]);
          setCurrent(null);
        }

        await sleep(LOOP_PAUSE_MS);
      }
    }

    void run();
    return () => {
      signal.cancelled = true;
    };
  }, [visible, reducedMotion]);

  const displayed = current ? [...lines, current] : lines;

  return (
    <div ref={ref} className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
      <div className="border-b border-neutral-800 px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">Terminal</span>
      </div>
      <div className="min-h-[400px] overflow-x-auto px-5 py-5 font-mono text-[13px] leading-relaxed">
        {displayed.map((line, i) => {
          const isLast = i === displayed.length - 1;
          return (
            <div key={line.key} className={`whitespace-pre ${lineClassName(line.tone)}`}>
              {line.text || " "}
              {isLast && isTyping && (
                <span
                  aria-hidden="true"
                  className="ml-0.5 inline-block h-[1em] w-[0.5em] translate-y-[0.15em] bg-neutral-100 align-baseline [animation:blink-cursor_1s_steps(1)_infinite]"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
