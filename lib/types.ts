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
  currentStage: PipelineStage;
  createdAt: string;
  updatedAt: string;
}
