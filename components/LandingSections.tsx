"use client";

import { useId, useState } from "react";
import { motion } from "framer-motion";
import { EASE, Kicker, LineReveal } from "@/components/fx/Reveal";

const STEPS = [
  { word: "Roll", line: "A random idea — or your own." },
  { word: "Spec", line: "A scoped PRD, editable per section." },
  { word: "Stack", line: "A curated pick you can override." },
  { word: "Ship", line: "Boilerplate, running live in-browser." },
];

/** Four poster-sized verbs, one line each — the whole product in a glance. */
export function HowItWorks() {
  return (
    <section id="about" className="mx-auto w-full max-w-6xl px-5 py-28 sm:px-10">
      <Kicker>How it works</Kicker>
      <LineReveal
        lines={["One idea.", <span key="b" className="text-muted">Four moves.</span>]}
        className="mt-5 font-display text-6xl uppercase leading-[0.9] sm:text-8xl"
      />

      <ol className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <motion.li
            key={step.word}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-10% 0px" }}
            transition={{ duration: 0.8, ease: EASE, delay: i * 0.1 }}
            className="group relative isolate flex min-h-[17rem] flex-col justify-between overflow-hidden bg-background p-7"
          >
            {/* Lime fill that rises from the bottom on hover. */}
            <span
              aria-hidden="true"
              className="absolute inset-0 -z-10 origin-bottom scale-y-0 bg-accent transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-y-100"
            />
            <span className="font-mono text-xs text-muted transition-colors duration-300 group-hover:text-accent-ink">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="transition-colors duration-300 group-hover:text-accent-ink">
              <p className="font-display text-6xl uppercase leading-none transition-transform duration-500 group-hover:-translate-y-1">
                {step.word}
              </p>
              <p className="mt-3 text-sm text-muted transition-colors duration-300 group-hover:text-accent-ink/80">{step.line}</p>
            </div>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

const FAQ_ITEMS = [
  {
    q: "Do I need to sign up?",
    a: "No. Everything works as a guest. Sign in with GitHub only to keep a project or push it to a repo.",
  },
  {
    q: "How long does a guest session last?",
    a: "Until it goes idle for a while — then it's purged automatically. Sign in before that to keep it.",
  },
  {
    q: "Can I push the code to GitHub?",
    a: "Yes. Sign in, grant repo access on your account page, turn on auto-push.",
  },
  {
    q: "Is the boilerplate actually tested?",
    a: "It's syntax-checked automatically. Live Preview goes further — it installs and runs it in your browser.",
  },
  {
    q: "Is there a generation limit?",
    a: "A small daily cap per stage. Signing in raises it.",
  },
];

/** Single-open accordion (WAI-ARIA Accordion Pattern). */
export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const baseId = useId();

  return (
    <section id="faq" className="mx-auto w-full max-w-6xl px-5 py-28 sm:px-10">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <Kicker>FAQ</Kicker>
          <LineReveal lines={["Quick", "answers."]} className="mt-5 font-display text-6xl uppercase leading-[0.9] sm:text-7xl" />
        </div>

        <div className="border-t border-line">
          {FAQ_ITEMS.map((item, i) => {
            const isOpen = openIndex === i;
            const buttonId = `${baseId}-faq-button-${i}`;
            const panelId = `${baseId}-faq-panel-${i}`;
            return (
              <div key={item.q} className="border-b border-line">
                <h3>
                  <button
                    type="button"
                    id={buttonId}
                    onClick={() => setOpenIndex(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    className="group flex w-full items-center justify-between gap-6 py-6 text-left"
                  >
                    <span className={`text-lg font-medium transition-colors sm:text-xl ${isOpen ? "text-accent" : "group-hover:text-accent"}`}>{item.q}</span>
                    <span
                      aria-hidden="true"
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-all duration-500 ${
                        isOpen ? "rotate-45 border-accent bg-accent text-accent-ink" : "border-line group-hover:border-accent"
                      }`}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                      </svg>
                    </span>
                  </button>
                </h3>
                <div className={`grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <div className="overflow-hidden">
                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={buttonId}
                      aria-hidden={!isOpen}
                      className={`max-w-prose pb-6 text-muted transition-opacity duration-500 ${isOpen ? "opacity-100 delay-100" : "opacity-0"}`}
                    >
                      {item.a}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
