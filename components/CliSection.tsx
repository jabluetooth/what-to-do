import CliTerminalDemo from "@/components/CliTerminalDemo";

/**
 * Presents the create-whattodo CLI (packages/create-whattodo) the same way floe.one presents its
 * own CLI: a live-feeling terminal demo next to a short "why" list, no separate hero of its own.
 * Deliberately monochrome, matching this app's forced-dark, zero-accent-color palette (see
 * Footer.tsx's own comment on that) — CliTerminalDemo uses the CLI's real ▸/✔ symbols but weight/
 * opacity instead of the CLI's actual ANSI colors, since this site never introduces color anywhere
 * else either.
 */

const WHY_ITEMS = [
  "No install step — npx fetches and runs it on demand, same as create-next-app.",
  "Same guest-tier pipeline and limits as this page, not a separate or elevated quota.",
  "Works anywhere a terminal does — scripts, CI, or just faster than a browser.",
];

export default function CliSection() {
  return (
    <section
      id="cli"
      className="mx-auto w-full max-w-5xl px-6 sm:px-12 py-24 border-t border-neutral-200 dark:border-neutral-800"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">CLI</p>
      <h2 className="mt-4 text-2xl sm:text-3xl font-bold tracking-tight">Same pipeline, no browser required</h2>
      <p className="mt-4 max-w-prose text-neutral-600 dark:text-neutral-400">
        <code className="rounded bg-neutral-100 dark:bg-white/10 px-1.5 py-0.5 font-mono text-[0.9em]">
          npx create-whattodo
        </code>{" "}
        runs the exact same guest pipeline as this page — idea, PRD, stack, boilerplate — straight from your
        terminal, and drops a real project on your machine when it&apos;s done.
      </p>

      <div className="mt-12 grid grid-cols-1 items-start gap-10 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <ul className="space-y-5">
            {WHY_ITEMS.map((item) => (
              <li key={item} className="border-t border-neutral-200 dark:border-neutral-800 pt-3 text-sm text-neutral-600 dark:text-neutral-400">
                {item}
              </li>
            ))}
          </ul>

          <a
            href="https://www.npmjs.com/package/create-whattodo"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100 hover:underline underline-offset-4"
          >
            View create-whattodo on npm
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M7 7h10v10" />
            </svg>
          </a>
        </div>

        <CliTerminalDemo />
      </div>
    </section>
  );
}
