import { z } from "zod";

/** Request shapes shared by the mobile routes, so a prompt, PRD or stack is bounded the same way everywhere. */

export const HintsSchema = z.object({
  platform: z.enum(["web", "mobile"]).optional(),
  scopeSize: z.enum(["weekend", "mvp", "production"]).optional(),
  stackFamiliarity: z.string().max(300).optional(),
});

export const PromptSchema = z.string().trim().min(1).max(2000);

export const SectionsSchema = z
  .array(z.object({ key: z.string().max(60), title: z.string().max(120), content: z.string().max(6000) }))
  .min(1)
  .max(12);

const StackPieceSchema = z.object({ choice: z.string().max(120), rationale: z.string().max(1500) });

export const StackSchema = z.object({
  frontend: StackPieceSchema,
  backend: StackPieceSchema,
  database: StackPieceSchema,
  hosting: StackPieceSchema,
  auth: StackPieceSchema,
});
