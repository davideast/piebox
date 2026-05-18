import type { IPromptService, PromptInput, PromptOutput, PromptError } from "./spec.js";
import { PromptInputSchema } from "./spec.js";
import type { Result } from "../shared/result.js";
import { ok, fail } from "../shared/result.js";
import { SandboxManager } from "../../sandbox-manager.js";
import { resolveModel } from "../../utils/model-resolver.js";
import { createSandboxedSession } from "@piebox/driver-agent";

export class PromptHandler implements IPromptService {
  constructor(private manager: SandboxManager) {}

  async execute(input: PromptInput): Promise<Result<PromptOutput, PromptError>> {
    const parseResult = PromptInputSchema.safeParse(input);
    if (!parseResult.success) {
      return fail("INVALID_INPUT", parseResult.error.errors[0]?.message ?? "Invalid input");
    }

    const { sandboxName, prompt, model } = parseResult.data;

    if (!(await this.manager.exists(sandboxName))) {
      return fail("NOT_FOUND", `Sandbox ${sandboxName} does not exist`);
    }

    let resolvedModel;
    try {
      resolvedModel = resolveModel(model);
    } catch (e: unknown) {
      return fail("MODEL_ERROR", (e instanceof Error ? e.message : String(e)));
    }

    let sb;
    try {
      sb = await this.manager.load(sandboxName);
    } catch (e: unknown) {
      return fail("NOT_FOUND", (e instanceof Error ? e.message : String(e)));
    }

    try {
      const { session } = await createSandboxedSession({
        model: resolvedModel,
        vfs: sb.fs,
        bash: sb.shell,
        cwd: sb.cwd,
      });
      await session.prompt(prompt);
    } catch (e: unknown) {
      return fail("SESSION_FAILED", (e instanceof Error ? e.message : String(e)) || "Session prompt failed");
    }

    await this.manager.save(sandboxName, sb);
    return ok({ sandboxName });
  }
}
