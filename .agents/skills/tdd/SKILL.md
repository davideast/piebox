---
name: tdd
description: >
  Enforces a disciplined Red-Green-Refactor (TDD) workflow in TypeScript with Vitest.
  Use when creating new features, fixing bugs, or migrating logic to ensure
  high-quality, verifiable implementations. Pairs with the typed-service-contract skill.
license: Apache-2.0
metadata:
  author: David East
  version: "2.0"
---

# Red-Green-Refactor (TDD)

Build every feature, fix, and migration through a strict test-first loop. Write one failing test, make it pass with minimal code, then clean up. Never write implementation before a test exists for it.

**Default test runner:** Vitest. All examples use `vitest` imports. Use `bun test` if running in Bun (API-compatible).

## When to use this skill

- Creating a new feature (write tests for the next behavior)
- Fixing a bug (write a test that reproduces it first)
- Migrating or refactoring logic (write tests that lock current behavior, then swap)

## Output

Each TDD cycle produces:

| File | Purpose |
|---|---|
| `*.test.ts` | One or more test cases proving the behavior exists |
| `*.ts` | The minimal implementation that satisfies all tests |

The cycle is complete when all tests pass and the acceptance checklist (Phase 4) is satisfied.

## The Loop

### Phase 1: Red — Prove the behavior doesn't exist

Write **one** test for the next small piece of behavior. Run it. It must fail.

```typescript
// user-service.test.ts
import { describe, it, expect, vi } from "vitest";
import { createUser } from "./user-service.js";

describe("createUser", () => {
  it("returns the created user with an ID", async () => {
    const db = { insert: vi.fn().mockResolvedValue({ id: "u1", email: "a@b.com" }) };
    const user = await createUser(db, { email: "a@b.com", name: "Alice" });
    expect(user.id).toBe("u1");
    // Fails: createUser does not exist yet
  });
});
```

**Verify the failure is real:** The error should be `Cannot find module './user-service.js'` or `createUser is not a function` — a missing-logic error, not a config error. If the failure is about missing imports, broken paths, or TypeScript config, fix that first before proceeding.

### Phase 2: Green — Make it pass with minimal code

Write the simplest implementation that satisfies the test. Do not build for the future.

```typescript
// user-service.ts
export async function createUser(db: any, input: { email: string; name: string }) {
  return await db.insert(input);
}
```

Run the test. It must pass. This is the "proof of work" — the transition from Red to Green.

### Phase 3: Refactor — Clean up while staying Green

Improve types, naming, and structure. Run tests after every change. If they go Red, revert immediately.

```typescript
// user-service.ts
interface Database {
  insert(data: Record<string, unknown>): Promise<{ id: string; email: string }>;
}

interface CreateUserInput {
  email: string;
  name: string;
}

export async function createUser(db: Database, input: CreateUserInput) {
  return await db.insert({ email: input.email, name: input.name });
}
```

### Phase 4: Accept — Verify the cycle is done

Before starting the next cycle, check:

- [ ] All tests pass
- [ ] The test name describes the **behavior**, not the implementation (e.g., "returns created user" not "calls db.insert")
- [ ] No implementation exists without a corresponding test
- [ ] No test was modified to make a failing implementation pass
- [ ] Types are explicit — no `any` remaining from Phase 2

If any item fails, fix it before starting the next Red phase.

## Workflows by Task Type

### New Feature

Follow the loop above. Each cycle adds one behavior:

1. `it("returns created user with an ID")` → implement `createUser`
2. `it("rejects duplicate emails")` → add duplicate check
3. `it("validates email format")` → add validation

**Termination:** The feature is done when all acceptance criteria from the task have a corresponding passing test.

### Bug Fix

Start by reproducing the bug as a failing test, then fix it:

1. **Red:** Write a test that exercises the exact bug scenario. It must fail (proving the bug exists).
2. **Green:** Fix the implementation. The test passes.
3. **Refactor:** Clean up if needed.

```typescript
// Reproducing a bug: off-by-one in pagination
it("returns page 2 starting at offset 10, not 11", async () => {
  const result = await paginate({ page: 2, pageSize: 10 });
  expect(result.offset).toBe(10); // Was returning 11 — the bug
});
```

**Termination:** The reproduction test passes and no existing tests are broken.

### Migration / Refactoring

Lock current behavior with tests first, then swap the implementation:

1. **Red:** Write tests that assert the current output/behavior of the existing code. They should pass immediately (they're documenting what exists).
2. **Swap:** Replace the implementation (new framework, new library, new architecture).
3. **Green:** Run the tests. Fix the new implementation until all tests pass.

```typescript
// Locking current behavior before migrating from Commander to Citty
it("list command exports a valid command definition", async () => {
  const mod = await import("./commands/list.js");
  expect(mod.default).toBeDefined();
  expect(mod.default.meta.name).toBe("list");
});
```

**Termination:** All pre-migration tests pass against the new implementation.

## Core Rules

### 1. No Horizontal Splurging

Write **one test at a time**. Never write multiple tests before implementing any of them.

```
✅ Write 1 test → See it fail → Write 1 fix → See it pass → Repeat
❌ Write 5 tests → Write all implementations → Hope they pass
```

### 2. Backpressure Through Types

Use TypeScript's type system to make invalid states unrepresentable. This prevents the implementation from "drifting" into incorrect but test-passing code.

```typescript
// Bad: any allows silent bugs
export async function createUser(db: any, input: any) { ... }

// Good: types enforce the contract — compiler catches misuse
interface Database {
  insert(data: CreateUserInput): Promise<User>;
}
export async function createUser(db: Database, input: CreateUserInput): Promise<User> { ... }
```

### 3. Never Modify Tests to Fit Implementation

If a test must change, it's because the **requirement** changed, not because the code is difficult to write. If you're tempted to relax an assertion, stop and fix the implementation instead.

### 4. Name Tests for Behavior, Not Implementation

```typescript
// Bad: coupled to implementation details
describe("UserService.insertIntoPostgres", () => { ... });

// Good: describes what the user gets
describe("createUser", () => {
  it("returns the created user with an ID", ...);
  it("rejects duplicate email addresses", ...);
});
```

## Gotchas

- **Hardcoded absolute paths in tests:** Using `/Users/you/project/...` breaks CI and other machines. Always use `path.resolve(".")` or `import.meta.url` for relative resolution.
- **Dead side-effect validation:** Calling a validation function but ignoring its return value. The parsed result must be the only source of truth for the rest of the execution. Parse, don't validate.
- **Shadowed type noise:** Suppressing TypeScript errors with `@ts-ignore` instead of fixing the type root config. Create a `tsconfig.json` in your test directory to include `vitest` types cleanly.
- **Testing implementation, not behavior:** If renaming an internal function breaks your tests, the tests are too tightly coupled. Test the public contract.
- **Forgetting the refactor phase:** Going Red → Green → Red → Green without ever cleaning up Phase 2's `any` types and minimal code. Schedule refactor time explicitly.

## Related Skills

- **[typed-service-contract](../typed-service-contract/SKILL.md)** — Defines the Spec & Handler architecture. Use TDD to build each vertical slice: write contract tests (spec) first, then logic tests (handler), following the Red-Green-Refactor loop for each.

## Reference Materials

- **[references/cli-testing-patterns.md](references/cli-testing-patterns.md)** — Read when applying TDD to CLI commands. Covers behavior-centric test naming, the testing pyramid for CLIs (unit → integration → interactive), and framework migration patterns.