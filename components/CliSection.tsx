"use client";

import CliTerminalDemo from "@/components/CliTerminalDemo";
import { Kicker, LineReveal, Rise } from "@/components/fx/Reveal";

/** Presents the create-whattodo CLI (packages/create-whattodo): a live-feeling terminal demo and
 *  one copyable command — the terminal does the explaining. */
export default function CliSection() {
  return (
    <section id="cli" className="mx-auto w-full max-w-6xl px-5 py-28 sm:px-10">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_1.3fr]">
        <div>
          <Kicker>CLI</Kicker>
          <LineReveal
            lines={["Same pipeline.", <span key="b" className="text-muted">No browser.</span>]}
            className="mt-5 font-display text-6xl uppercase leading-[0.9] sm:text-7xl"
          />
          <Rise delay={0.2}>
            <code className="mt-8 inline-flex items-center gap-3 rounded-full border border-line bg-surface px-5 py-3 font-mono text-sm">
              <span className="text-accent">$</span> npx create-whattodo
            </code>
          </Rise>
          <Rise delay={0.3}>
            <a
              href="https://www.npmjs.com/package/create-whattodo"
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-accent"
            >
              View on npm
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M7 7h10v10" />
              </svg>
            </a>
          </Rise>
        </div>

        <Rise delay={0.15}>
          <CliTerminalDemo />
        </Rise>
      </div>
    </section>
  );
}
