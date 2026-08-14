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
   * Whether the generated boilerplate can run in a WebContainer preview (PRD §6.5). Always true
   * in v1 since the only seed template is JS/TS (Next.js) regardless of the recommended stack —
   * this flag is the hook for when non-JS templates (Django, Rails, ...) exist, rather than
   * inferring preview support from the recommended stack text, which could mismatch what was
   * actually generated.
   */
  boilerplateWebContainerCompatible?: boolean;
  currentStage: PipelineStage;
  createdAt: string;
  updatedAt: string;
}
