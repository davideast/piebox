import type { ICloneService, CloneInput, CloneOutput, CloneError } from "./spec.js";
import { CloneInputSchema } from "./spec.js";
import type { Result } from "../shared/result.js";
import { ok, fail } from "../shared/result.js";
import { SandboxManager } from "../../sandbox-manager.js";

export class CloneHandler implements ICloneService {
  constructor(private manager: SandboxManager) {}

  async execute(input: CloneInput): Promise<Result<CloneOutput, CloneError>> {
    const parseResult = CloneInputSchema.safeParse(input);
    if (!parseResult.success) {
      return fail("INVALID_INPUT", parseResult.error.errors[0]?.message ?? "Invalid input");
    }

    const { url, sandboxName } = parseResult.data;

    if (await this.manager.exists(sandboxName)) {
      return fail("ALREADY_EXISTS", `Sandbox ${sandboxName} already exists`);
    }

    const sb = await this.manager.create(sandboxName, url);
    try {
      await sb.clone({ url });
    } catch (e: unknown) {
      // Clean up failed sandbox
      await this.manager.destroy(sandboxName);
      return fail("CLONE_FAILED", (e instanceof Error ? e.message : String(e)) || "Failed to clone repository");
    }

    await this.manager.save(sandboxName, sb);
    return ok({ sandboxName });
  }
}
