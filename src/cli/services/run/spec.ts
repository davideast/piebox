import { z } from "zod";
import type { Result } from "../shared/result.js";
import { SandboxNameSchema, GitUrlSchema, OutputPathSchema } from "../shared/schemas.js";

export const RunInputSchema = z.object({
  prompt: z.string().min(1, "Prompt cannot be empty"),

  // Source: one of --url, --dir, or sandbox name (existing sandbox)
  sandboxName: SandboxNameSchema.optional(),
  url: GitUrlSchema.optional(),
  dir: z.string().optional(),

  // Model
  model: z.string().optional(),

  // Run chaining
  continue: z.boolean().default(false),
  from: z.string().optional(),

  // Context injection
  context: z.array(z.string()).optional(),

  // Post-run actions
  commit: z.boolean().optional(),
  outPath: OutputPathSchema.optional(),
  apply: z.boolean().default(false),

  // UX
  verbose: z.boolean().default(false),
  quiet: z.boolean().default(false),
});

export type RunInput = z.infer<typeof RunInputSchema>;

export type RunError =
  | { code: "INVALID_INPUT"; message: string }
  | { code: "DIR_NOT_FOUND"; message: string }
  | { code: "NO_PREVIOUS_RUN"; message: string }
  | { code: "RUN_NOT_FOUND"; message: string }
  | { code: "CLONE_FAILED"; message: string }
  | { code: "SESSION_FAILED"; message: string }
  | { code: "PROMPT_FAILED"; message: string }
  | { code: "COMMIT_FAILED"; message: string }
  | { code: "EXPORT_FAILED"; message: string };

export interface RunOutput {
  sandboxName?: string;
  runId?: string;
  elapsedMs: number;
  newFiles: string[];
  modifiedFiles: string[];
  unchangedCount: number;
  outputDir?: string;
  filesWritten: number;
  bytesWritten: number;
  commitSha?: string;
  logFile?: string;
}

export interface IRunService {
  execute(input: RunInput): Promise<Result<RunOutput, RunError>>;
}
