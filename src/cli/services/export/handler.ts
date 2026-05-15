import type { IExportService, ExportInput, ExportOutput, ExportError } from "./spec.js";
import { ExportInputSchema } from "./spec.js";
import type { Result } from "../shared/result.js";
import { ok, fail } from "../shared/result.js";
import { SandboxManager } from "../../sandbox-manager.js";

export class ExportHandler implements IExportService {
  constructor(private manager: SandboxManager) {}

  async execute(input: ExportInput): Promise<Result<ExportOutput, ExportError>> {
    const parseResult = ExportInputSchema.safeParse(input);
    if (!parseResult.success) {
      return fail("INVALID_INPUT", parseResult.error.errors[0]?.message ?? "Invalid input");
    }

    const { sandboxName, outPath } = parseResult.data;

    if (!(await this.manager.exists(sandboxName))) {
      return fail("NOT_FOUND", `Sandbox ${sandboxName} does not exist`);
    }

    let sb;
    try {
      sb = await this.manager.load(sandboxName);
    } catch (e: unknown) {
      return fail("NOT_FOUND", (e instanceof Error ? e.message : String(e)));
    }

    try {
      const result = await sb.export(outPath);
      return ok(result);
    } catch (e: unknown) {
      return fail("WRITE_FAILED", (e instanceof Error ? e.message : String(e)) || "Failed to export files");
    }
  }
}
