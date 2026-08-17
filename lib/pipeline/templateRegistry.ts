/**
 * One descriptor per supported language/framework's data — id, matching rules, and stack-pick
 * overrides. Deliberately has NO imports from lib/llm or lib/sandbox: stackMatrix.ts (and
 * therefore app/page.tsx, a client component) needs this file, and those modules pull in
 * server-only Node builtins (child_process, fs) that Turbopack correctly refuses to bundle for
 * the browser. The actual generation/validation logic lives in templateImplementations.ts,
 * server-only, keyed by the same id — see that file for why the split exists and how the two
 * stay in sync.
 */
export interface TemplateDescriptor {
  /** Matches a folder name under templates/ — passed straight to loadTemplate(). */
  id: string;
  /** Exact string stored as StackRecommendation.backend.choice — the join key from a stack pick back to this template. */
  backendChoice: string;
  /** Free-text "stacks I know" keywords that should auto-steer pickStack() toward this template. */
  keywords: string[];
  /** False for templates whose generated code isn't JS/TS — WebContainer only ever runs JS/WASM. */
  webContainerCompatible: boolean;
  /** Forces stackMatrix's frontend pick when this template is chosen (e.g. a backend-only template has no matching frontend to recommend). Omit to leave the normal frontend heuristic alone. */
  frontendOverride?: string;
  /** Forces stackMatrix's hosting pick when this template is chosen. Omit to leave the normal heuristic alone. */
  hostingOverride?: string;
  /** Forces stackMatrix's auth pick when this template is chosen. Omit to leave the normal heuristic alone. */
  authOverride?: string;
}

/** First entry is the fallback (see resolveTemplate) — keep it that way rather than reordering. */
export const TEMPLATE_REGISTRY: TemplateDescriptor[] = [
  {
    id: "nextjs-postgres-drizzle",
    backendChoice: "Next.js API routes / Server Actions (same app)",
    keywords: [],
    webContainerCompatible: true,
  },
  {
    id: "fastapi-postgres",
    backendChoice: "FastAPI (Python)",
    // "python" alone (not just a specific framework name) also steers here — someone who types
    // "I know Python" but not "FastAPI" by name is exactly who this branch exists for.
    keywords: ["django", "rails", "ruby", "fastapi", "flask", "python"],
    webContainerCompatible: false,
    // The FastAPI template is backend-only (no frontend files at all — see
    // templates/fastapi-postgres/) — recommending a separate frontend framework alongside it
    // would claim something generation never delivers.
    frontendOverride: "None (API only, no generated frontend)",
    hostingOverride: "Railway",
    // Auth.js is itself a Next.js-ecosystem library, not just "unimplemented for FastAPI" the
    // way hosting/DB choices are — recommending it for a Python API is a category mismatch.
    authOverride: "Roll your own (FastAPI has no bundled auth library)",
  },
];

export const DEFAULT_TEMPLATE: TemplateDescriptor = TEMPLATE_REGISTRY[0];

/** Resolves a recommended stack's backend pick to its descriptor, falling back to the default (Next.js) template for any backend without a real template (NestJS/Django/Rails — override-only choices, see stackMatrix.ts). */
export function resolveTemplate(backendChoice: string | undefined): TemplateDescriptor {
  return TEMPLATE_REGISTRY.find((t) => t.backendChoice === backendChoice) ?? DEFAULT_TEMPLATE;
}

export function getTemplateById(id: string): TemplateDescriptor | undefined {
  return TEMPLATE_REGISTRY.find((t) => t.id === id);
}
