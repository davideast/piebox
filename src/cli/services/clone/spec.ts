import { z } from "zod";
import type { Result } from "../shared/result.js";
import { GitUrlSchema, SandboxNameSchema } from "../shared/schemas.js";

export const CloneInputSchema = z.object({
  url: GitUrlSchema,
  sandboxName: SandboxNameSchema,
});

export type CloneInput = z.infer<typeof CloneInputSchema>;

export type CloneError =
  | { code: "INVALID_INPUT"; message: string }
  | { code: "CLONE_FAILED"; message: string }
  | { code: "ALREADY_EXISTS"; message: string };

export type CloneOutput = {
  sandboxName: string;
};

export interface ICloneService {
  execute(input: CloneInput): Promise<Result<CloneOutput, CloneError>>;
}
