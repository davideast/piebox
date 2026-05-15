---
name: typed-service-contract
description: Architecture standard for building robust, type-safe TypeScript services using the Spec and Handler pattern. Use when building CLIs, libraries, APIs, or complex business logic that requires strict input validation, exhaustive error handling, and testable vertical slices.
license: Apache-2.0
metadata:
  author: David East
  version: "1.0"
---

# Typed Service Contract (Spec & Handler Pattern)

Build type-safe TypeScript services as vertical slices. Each unit of work gets a **Spec** (the contract — input, output, errors) and a **Handler** (the implementation — side effects, orchestration). Errors are values, not exceptions. Inputs are parsed, not validated.

## When to use this skill

- Building CLIs, libraries, or APIs with strict boundaries between input and logic
- Complex validation where inputs require transformation (parsing) before use
- High-reliability systems where unhandled runtime exceptions are unacceptable
- Any TypeScript service where you want to separate data validation tests from logic tests

## Output

This skill produces a vertical slice — a set of files for one unit of work:

| File | Purpose |
|---|---|
| `spec.ts` | The contract: input schema, error codes, result type, interface |
| `handler.ts` | The implementation: business logic, side effects, error mapping |
| `spec.test.ts` | Contract tests: validate schemas reject bad input |
| `handler.test.ts` | Logic tests: verify handler returns correct results |

## Directory Structure

Organize vertical slices by domain. Each operation gets its own directory:

```
src/
  methods/
    user/
      create/
        spec.ts
        handler.ts
      delete/
        spec.ts
        handler.ts
    billing/
      charge/
        spec.ts
        handler.ts
test/
  unit/
    methods/
      user/
        create/
          spec.test.ts
          handler.test.ts
```

**Rules:**
- One handler = one operation = one `execute()` method
- Test files mirror the source directory structure (zero-contention — adding a feature never modifies existing test files)
- Domain grouping (`user/`, `billing/`) keeps the directory manageable at scale

## Workflow

### Phase 1: Define the Contract (`spec.ts`)

The spec defines *what* the operation does without saying *how*. It contains five parts:

```typescript
import { z } from "zod";

// 1. VALIDATION HELPERS — reusable refinements
export const SafePathSchema = z.string()
  .min(1)
  .refine(p => !p.includes(".."), "Path traversal not allowed");

// 2. INPUT — "Parse, don't validate"
// Transforms raw input into a guaranteed-valid DTO at the boundary.
export const CreateUserInputSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(["admin", "member", "viewer"]).default("member"),
});
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

// 3. ERROR CODES — exhaustive, domain-specific
export const CreateUserErrorCode = z.enum([
  "EMAIL_ALREADY_EXISTS",
  "INVALID_DOMAIN",
  "DATABASE_ERROR",
  "UNKNOWN_ERROR",
]);
export type CreateUserErrorCode = z.infer<typeof CreateUserErrorCode>;

// 4. RESULT — discriminated union of Success | Failure
export interface CreateUserSuccess {
  success: true;
  data: { id: string; email: string; role: string };
}

export interface CreateUserFailure {
  success: false;
  error: {
    code: CreateUserErrorCode;
    message: string;
    suggestion?: string;
    recoverable: boolean;
  };
}

export type CreateUserResult = CreateUserSuccess | CreateUserFailure;

// 5. INTERFACE — the capability contract
export interface CreateUserSpec {
  execute(input: CreateUserInput): Promise<CreateUserResult>;
}
```

**Key rules:**
- Input schemas use Zod for parsing at the boundary — callers get a validated DTO, not raw strings
- Error codes are exhaustive enums, not generic `"ERROR"` strings
- Results are discriminated unions — `success: true | false` — enabling exhaustive `if` checks
- The interface defines the single `execute()` method

### Phase 2: Implement the Handler (`handler.ts`)

The handler defines *how* the contract is fulfilled. It handles side effects and **never throws**.

```typescript
import type { CreateUserSpec, CreateUserInput, CreateUserResult } from "./spec.js";
import type { Database } from "../../../db.js";

export class CreateUserHandler implements CreateUserSpec {
  constructor(private db: Database) {}

  async execute(input: CreateUserInput): Promise<CreateUserResult> {
    try {
      // Check preconditions — return explicit errors, don't throw
      const existing = await this.db.findByEmail(input.email);
      if (existing) {
        return {
          success: false,
          error: {
            code: "EMAIL_ALREADY_EXISTS",
            message: `User with email ${input.email} already exists`,
            suggestion: "Use a different email address",
            recoverable: true,
          },
        };
      }

      // Business logic
      const user = await this.db.createUser(input);

      // Success
      return {
        success: true,
        data: { id: user.id, email: user.email, role: user.role },
      };

    } catch (error) {
      // Safety net: catch unknown runtime errors
      return {
        success: false,
        error: {
          code: "UNKNOWN_ERROR",
          message: error instanceof Error ? error.message : String(error),
          recoverable: false,
        },
      };
    }
  }
}
```

**Key rules:**
- The handler **implements** the spec interface — TypeScript enforces the contract
- Dependencies are injected via the constructor (makes testing trivial)
- **Never throw.** Every error path returns a typed `Failure` result
- The `catch` block is a safety net for truly unexpected errors — map them to `UNKNOWN_ERROR`
- Side effects (DB, network, filesystem) live here, not in the spec

### Phase 3: Write Tests

Split tests into two categories. Never write monolithic test files.

#### A. Contract Tests (`spec.test.ts`)

Test the *bouncer*. Verify the schema rejects invalid input and parses valid input correctly. Use data-driven table tests.

```typescript
import { describe, it, expect } from "vitest";
import { CreateUserInputSchema } from "./spec.js";

describe("CreateUserInputSchema", () => {
  const validCases = [
    { input: { email: "alice@example.com", name: "Alice" }, desc: "minimal valid input" },
    { input: { email: "bob@co.uk", name: "Bob", role: "admin" }, desc: "with explicit role" },
  ];

  const invalidCases = [
    { input: { email: "not-an-email", name: "Alice" }, desc: "invalid email" },
    { input: { email: "alice@example.com", name: "" }, desc: "empty name" },
    { input: { email: "alice@example.com", name: "A".repeat(101) }, desc: "name too long" },
  ];

  it.each(validCases)("accepts $desc", ({ input }) => {
    const result = CreateUserInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it.each(invalidCases)("rejects $desc", ({ input }) => {
    const result = CreateUserInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("applies default role", () => {
    const result = CreateUserInputSchema.parse({ email: "a@b.com", name: "A" });
    expect(result.role).toBe("member");
  });
});
```

#### B. Logic Tests (`handler.test.ts`)

Test the *chef*. Mock dependencies, call `execute()`, and assert the Result object.

```typescript
import { describe, it, expect, vi } from "vitest";
import { CreateUserHandler } from "./handler.js";

function mockDb(overrides: Record<string, unknown> = {}) {
  return {
    findByEmail: vi.fn().mockResolvedValue(null),
    createUser: vi.fn().mockResolvedValue({ id: "u1", email: "a@b.com", role: "member" }),
    ...overrides,
  };
}

describe("CreateUserHandler", () => {
  it("returns success when user is created", async () => {
    const handler = new CreateUserHandler(mockDb() as any);
    const result = await handler.execute({ email: "a@b.com", name: "A", role: "member" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("u1");
    }
  });

  it("returns EMAIL_ALREADY_EXISTS when duplicate", async () => {
    const db = mockDb({ findByEmail: vi.fn().mockResolvedValue({ id: "existing" }) });
    const handler = new CreateUserHandler(db as any);
    const result = await handler.execute({ email: "a@b.com", name: "A", role: "member" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("EMAIL_ALREADY_EXISTS");
      expect(result.error.recoverable).toBe(true);
    }
  });

  it("returns UNKNOWN_ERROR on unexpected failure", async () => {
    const db = mockDb({ createUser: vi.fn().mockRejectedValue(new Error("connection lost")) });
    const handler = new CreateUserHandler(db as any);
    const result = await handler.execute({ email: "a@b.com", name: "A", role: "member" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNKNOWN_ERROR");
      expect(result.error.recoverable).toBe(false);
    }
  });
});
```

### Phase 4: Validate

Walk this checklist before considering the slice complete:

- [ ] `spec.ts` has all 5 parts: validation helpers, input schema, error codes, result type, interface
- [ ] Input schema uses Zod with `.parse()` / `.safeParse()` — no manual validation
- [ ] Error codes are exhaustive — every failure mode has a named code
- [ ] Result type is a discriminated union with `success: true | false`
- [ ] Handler implements the spec interface
- [ ] Handler never throws — all errors mapped to result failures
- [ ] Dependencies are constructor-injected, not imported globally
- [ ] Contract tests cover valid and invalid input edge cases
- [ ] Logic tests mock dependencies and assert result objects
- [ ] Test files mirror the source directory structure

### Phase 5: Scale (when the handler grows)

When a handler's `execute()` method exceeds ~50 lines or handles more than 3 distinct steps, decompose it into **Ops** — focused functions that each return a Result.

> **Read [references/handler-decomposition.md](references/handler-decomposition.md)** for the full Ops Pattern with a worked example and the TDD safety-net ritual.

### Phase 6: Public API Boundary (for libraries)

When building a library or SDK, the internal Result pattern creates an "unwrap tax" for consumers. The solution: add a thin boundary layer that unwraps results and throws on failure.

> **Read [references/boundary-layer.md](references/boundary-layer.md)** for the throwing boundary pattern with examples for both human and agent consumers.

## Gotchas

- **`as any` in handlers:** When an external SDK doesn't expose proper types, you'll be tempted to use `as any`. Isolate these escapes in a single utility function so they're auditable, not scattered throughout the handler.
- **`process.env` scattering:** Don't read environment variables inside handler logic. Build a "context" object in the constructor or a setup function, then pass it as structured data.
- **`import.meta.glob` breaks tree-shaking:** If you use dynamic barrel generation for auto-registering handlers, prefer static barrel files (`index.ts` with explicit exports) for libraries intended for distribution.
- **Generic `UNKNOWN_ERROR` overuse:** If you find most failures landing in the catch-all `UNKNOWN_ERROR`, you're missing error codes. Add specific codes for each known failure mode.
- **Leaking Results to public APIs:** Internal handlers should use `Result<T>`. Public API classes should unwrap and throw. Never force consumers to check `.success` on every call. See Phase 6.

## Reference Materials

Load these files on demand when you hit the relevant phase:

- **[references/handler-decomposition.md](references/handler-decomposition.md)** — Read in Phase 5 when a handler exceeds ~50 lines. Covers the Ops Pattern, TDD safety-net ritual, and orchestrator refactoring.
- **[references/boundary-layer.md](references/boundary-layer.md)** — Read in Phase 6 when building a library with a public API. Covers the throwing boundary, `StitchError` pattern, and agent-friendly ergonomics.