import { z } from "zod";
import type { Result } from "../shared/result.js";
import { ok, fail } from "../shared/result.js";
import { SandboxNameSchema } from "../shared/schemas.js";
import { SandboxManager } from "../../sandbox-manager.js";

export const CommitInputSchema = z.object({
  sandboxName: SandboxNameSchema,
  message: z.string().optional(),
});

export type CommitInput = z.infer<typeof CommitInputSchema>;

export type CommitError =
  | { code: "INVALID_INPUT"; message: string }
  | { code: "NOT_FOUND"; message: string }
  | { code: "GIT_ERROR"; message: string };

export interface ICommitService {
  execute(input: CommitInput): Promise<Result<{ sha: string }, CommitError>>;
}

export class CommitHandler implements ICommitService {
  constructor(private manager: SandboxManager) {}

  async execute(input: CommitInput): Promise<Result<{ sha: string }, CommitError>> {
    const parseResult = CommitInputSchema.safeParse(input);
    if (!parseResult.success) {
      return fail("INVALID_INPUT", parseResult.error.errors[0]?.message ?? "Invalid input");
    }

    const { sandboxName, message } = parseResult.data;

    if (!(await this.manager.exists(sandboxName))) {
      return fail("NOT_FOUND", `Sandbox ${sandboxName} does not exist`);
    }

    let sb;
    try {
      sb = await this.manager.load(sandboxName);
    } catch (e: unknown) {
      return fail("NOT_FOUND", (e instanceof Error ? e.message : String(e)));
    }

    if (!sb.git) {
      return fail("GIT_ERROR", "Not a git repository. Clone first.");
    }

    try {
      await sb.git.addAll();
      const sha = await sb.git.commit(message || "Automated commit by piebox");
      await this.manager.save(sandboxName, sb);
      return ok({ sha });
    } catch (e: unknown) {
      return fail("GIT_ERROR", (e instanceof Error ? e.message : String(e)) || "Failed to commit");
    }
  }
}
