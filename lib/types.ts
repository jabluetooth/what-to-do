export type PlatformHint = "web" | "mobile";
export type ScopeSizeHint = "weekend" | "mvp" | "production";

export interface PromptHints {
  platform?: PlatformHint;
  scopeSize?: ScopeSizeHint;
  /** Free-text "stacks I already know" hint (PRD 6.1) — biases stack rec for guests with no history. */
  stackFamiliarity?: string;
}

export interface PrdSection {
  key: string;
  title: string;
  content: string;
}

export interface RandomIdea {
  title: string;
  /** Short phrase naming who it's for, e.g. "for freelancers who hate chasing invoices". */
  targetUser: string;
  description: string;
  platformTag: PlatformHint;
}

/** Fixed preset tags a mobile user can attach to a favorite (lib/db/schema.ts's favorites.tags) — mirrored in WhatToDo-mobile's lib/types.ts. */
export const PRESET_TAGS = ["Weekend project", "Startup idea", "For work", "Someday"] as const;
export type PresetTag = (typeof PRESET_TAGS)[number];

export type StackCategory = "frontend" | "backend" | "database" | "hosting" | "auth";

export interface StackPieceChoice {
  choice: string;
  rationale: string;
}

export type StackRecommendation = Record<StackCategory, StackPieceChoice>;

export type PipelineStage = "intake" | "prd" | "stack" | "boilerplate" | "preview";

export interface PendingClarification {
  question: string;
}

export interface GuestSession {
  id: string;
  prompt?: string;
  hints?: PromptHints;
  pendingClarification?: PendingClarification | null;
  prdSections?: PrdSection[];
  prdLowConfidence?: boolean;
  stack?: StackRecommendation;
  /** Set when the PRD changes after a stack was generated (PRD -> stack staleness cascade). */
  stackStale?: boolean;
  /** R2 prefix ("guest/{sessionId}/{jobId}") of the active, successfully-validated boilerplate. */
  boilerplateR2Prefix?: string;
  /** Set when the stack changes after a boilerplate was generated (stack -> boilerplate staleness cascade). */
  boilerplateStale?: boolean;
  /**
   * Whether the generated boilerplate can run in a WebContainer preview (PRD §6.5) — set from
   * which template actually produced it (lib/pipeline/templateRegistry.ts's
   * TemplateManifest.webContainerCompatible), not inferred from the recommended stack text, so
   * it can't mismatch what was actually
   * generated. False for the FastAPI template: /preview/[ref] falls back to a static file-tree
   * view instead of booting a live server.
   */
  boilerplateWebContainerCompatible?: boolean;
  /**
   * Client-reported, NOT server-verified — set only for WebContainer-compatible boilerplates, by
   * /preview/[ref] reporting back its own boot result (see
   * app/api/preview/report-validation/route.ts). Undefined until that's happened at least once.
   * The route checks the report is about the session's *current* boilerplate (not a stale one
   * from a prior generation) but has no way to confirm the client is telling the truth about
   * what its own WebContainer actually did — never gate anything security- or
   * payment-sensitive on this, it's a display-only confidence signal. Distinct from job success:
   * a job only ever confirms the generated code is syntactically valid
   * (lib/sandbox/validateSyntax.ts) — the server no longer attempts a real install+build itself,
   * since that reliably exhausted free-tier serverless disk quotas (ENOSPC), confirmed live in
   * production. This field is what "actually builds and runs" now means, and it's earned lazily,
   * client-side, the first time someone opens the preview.
   */
  boilerplateBuildVerified?: boolean;
  currentStage: PipelineStage;
  createdAt: string;
  updatedAt: string;
}
