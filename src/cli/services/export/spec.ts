import { z } from "zod";
import type { Result } from "../shared/result.js";
import { SandboxNameSchema, OutputPathSchema } from "../shared/schemas.js";

export const ExportInputSchema = z.object({
  sandboxName: SandboxNameSchema,
  outPath: OutputPathSchema,
});

export type ExportInput = z.infer<typeof ExportInputSchema>;

export type ExportError =
  | { code: "INVALID_INPUT"; message: string }
  | { code: "NOT_FOUND"; message: string }
  | { code: "WRITE_FAILED"; message: string };

export type ExportOutput = {
  filesWritten: number;
  bytesWritten: number;
  paths: string[];
};

export interface IExportService {
  execute(input: ExportInput): Promise<Result<ExportOutput, ExportError>>;
}
