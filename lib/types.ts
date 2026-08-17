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
  description: string;
  platformTag: PlatformHint;
}

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
  currentStage: PipelineStage;
  createdAt: string;
  updatedAt: string;
}
