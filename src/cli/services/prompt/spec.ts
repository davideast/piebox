import { z } from "zod";
import type { Result } from "../shared/result.js";
import { SandboxNameSchema } from "../shared/schemas.js";

export const PromptInputSchema = z.object({
  sandboxName: SandboxNameSchema,
  prompt: z.string().min(1, "Prompt cannot be empty"),
  model: z.string().optional(),
});

export type PromptInput = z.infer<typeof PromptInputSchema>;

export type PromptError =
  | { code: "INVALID_INPUT"; message: string }
  | { code: "NOT_FOUND"; message: string }
  | { code: "MODEL_ERROR"; message: string }
  | { code: "SESSION_FAILED"; message: string };

export type PromptOutput = {
  sandboxName: string;
};

export interface IPromptService {
  execute(input: PromptInput): Promise<Result<PromptOutput, PromptError>>;
}
