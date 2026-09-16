/**
 * Plain feature checklist, no marketing copy — mirrors floe.one's capabilities grid (short
 * headline + one line, whitespace and a border-t divider doing the separating instead of cards).
 * Every line here is a real, verifiable behavior of the shipped pipeline, not an aspiration.
 */
const CAPABILITIES = [
  {
    title: "No signup to try it",
    body: "The full pipeline — idea, PRD, stack, boilerplate, live preview — works as a guest.",
  },
  {
    title: "Boot-tested output",
    body: "Every generated project is checked for valid syntax before delivery, and actually installs and runs in-browser via WebContainer before you download it.",
  },
  {
    title: "CLI or browser",
    body: "npx create-whattodo drives the same pipeline as this page — pick whichever fits how you work.",
  },
  {
    title: "A real, connected UI",
    body: "The generated homepage fetches and posts to its own API route — not a static page next to a disconnected backend.",
  },
  {
    title: "Guest data expires on its own",
    body: "Nothing lingers after inactivity — sandbox sessions and their files are deleted automatically.",
  },
  {
    title: "Push straight to GitHub",
    body: "Sign in once, and a new repo is created automatically from what you generate.",
  },
];

export default function CapabilitiesSection() {
  return (
    <section
      id="capabilities"
      className="mx-auto w-full max-w-5xl px-6 sm:px-12 py-24 border-t border-neutral-200 dark:border-neutral-800"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
        Capabilities
      </p>
      <h2 className="mt-4 text-2xl sm:text-3xl font-bold tracking-tight">What&apos;s actually true, not just promised</h2>

      <ul className="mt-12 grid grid-cols-1 gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((item) => (
          <li key={item.title} className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
            <p className="font-semibold">{item.title}</p>
            <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">{item.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
