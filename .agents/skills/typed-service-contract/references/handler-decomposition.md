# Handler Decomposition: The Ops Pattern

When a handler's `execute()` method grows beyond ~50 lines or handles more than 3 distinct steps, decompose it into focused **Ops** — pure-ish functions that each return a Result type.

## When to decompose

Signs that a handler needs decomposition:

- The `execute()` method has more than 3 sequential steps with error-checking between them
- Multiple contributors are editing the same handler file (merge contention)
- Individual steps can't be tested without running the entire pipeline
- `process.env` or other environmental reads are scattered throughout the logic

## The Ops Pattern

### Step 1: Extract an Op

Move a self-contained step into its own function in an `ops/` subdirectory:

```
methods/project/init/
  spec.ts
  handler.ts
  ops/
    ensure-repo.ts      ← extracted
    resolve-templates.ts ← extracted
    build-commit-ctx.ts  ← extracted
```

Each op has a clear input → Result return signature:

```typescript
// ops/ensure-repo.ts
import type { InitResult } from "../spec.js";

interface EnsureRepoInput {
  owner: string;
  repo: string;
  createIfMissing: boolean;
}

export async function ensureRepo(
  octokit: Octokit,
  input: EnsureRepoInput,
): Promise<InitResult | { repoUrl: string }> {
  try {
    const exists = await octokit.repos.get({ owner: input.owner, repo: input.repo });
    return { repoUrl: exists.data.html_url };
  } catch {
    if (!input.createIfMissing) {
      return {
        success: false,
        error: { code: "REPO_NOT_FOUND", message: `${input.owner}/${input.repo} does not exist`, recoverable: true },
      };
    }
    const created = await octokit.repos.createForAuthenticatedUser({ name: input.repo });
    return { repoUrl: created.data.html_url };
  }
}
```

### Step 2: Simplify the Handler into an Orchestrator

The handler becomes a thin pipeline that calls ops and checks results:

```typescript
async execute(input: InitInput): Promise<InitResult> {
  // Step 1: Ensure repo exists
  const repoResult = await ensureRepo(this.octokit, input);
  if ("success" in repoResult && !repoResult.success) return repoResult;
  const { repoUrl } = repoResult as { repoUrl: string };

  // Step 2: Resolve templates
  const templates = await resolveTemplates(input.features);
  if ("success" in templates && !templates.success) return templates;

  // Step 3: Build commit context
  const ctx = await buildCommitContext(input, repoUrl);

  // Step 4: Commit and create PR
  return await this.commitAndCreatePR(ctx, templates);
}
```

## The TDD Safety-Net Ritual

Decomposing a handler is a refactoring operation. Follow this ritual to prevent regressions:

1. **Preserve existing tests.** Keep the original handler tests as a regression safety net. Do not modify them.
2. **Red (extract op).** Create the new op file and write a dedicated unit test for it. The test should fail because the op doesn't exist yet.
3. **Green (implement op).** Copy the logic from the handler to the op. Make the unit test pass.
4. **Refactor (orchestrate).** Replace the inline logic in the handler with a call to the new op.
5. **Verify.** Run BOTH the new op unit tests AND the original handler tests. Both must pass.

```bash
# Verify both test suites pass
vitest run test/unit/methods/project/init/handler.test.ts    # safety net
vitest run test/unit/methods/project/init/ops/ensure-repo.test.ts  # new tests
```

## Benefits

- **Testable steps.** Each op has its own focused tests — no need to mock the entire pipeline.
- **Reusable logic.** Ops can be imported by other handlers without instantiating the original handler.
- **Reduced cognitive load.** The handler reads as a 5-line orchestrator instead of a 130-line procedure.
- **Zero-contention.** New features add new ops and new test files — never modifying existing ones.
