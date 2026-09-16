import { findSection } from "@/lib/llm/boilerplateShared";
import type { PrdSection } from "@/lib/types";

/**
 * Deterministic (no LLM call) — every template's README.md ships as a static "Generated App"
 * stub with no idea-specific content, regardless of what actually got scaffolded. This swaps it
 * for one that names the real idea, the real resource, and the real files that got generated,
 * using data the pipeline already has on hand from the fill-in step.
 */
export function buildGeneratedReadme(input: {
  prompt: string;
  sections: PrdSection[];
  mainResourceName: string;
  whatsHereLines: string[];
  setupSteps: string;
  extraNote?: string;
}): string {
  const problem = findSection(input.sections, "problem_statement");
  const whatsHere = input.whatsHereLines.map((line) => `- ${line}`).join("\n");

  return `# Generated App

> "${input.prompt}"

${problem}

Scaffolded by [What To Do?](https://github.com/jabluetooth/what-to-do) — this is one representative slice built around a single resource, **${input.mainResourceName}**, not the whole PRD above. The rest of the feature list is still yours to build.

## What's here

${whatsHere}

## Setup

${input.setupSteps}
${input.extraNote ? `\n${input.extraNote}\n` : ""}`;
}
