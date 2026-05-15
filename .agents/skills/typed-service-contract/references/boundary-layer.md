# The Boundary Layer: Results Inside, Throws Outside

When building a library or SDK, the internal Result pattern creates friction for consumers. They don't want to check `.success` on every call — they want idiomatic TypeScript with `try/catch`.

The solution: add a **boundary layer** that preserves internal rigor while exposing an idiomatic external API.

## The Problem: Unwrap Tax

If you leak Result types directly to the public API, consumers face the "unwrap tax":

```typescript
// Leaked Result — tedious for humans and error-prone for agents
const result = await sdk.createProject("My App");
if (!result.success) throw new Error(result.error.message);
const project = result.data;

const screenResult = await project.generateScreen("Login page");
if (!screenResult.success) throw new Error(screenResult.error.message);
const screen = screenResult.data;
```

Every step requires a success check and `.data` access. For AI agents, this is especially dangerous — they tend to "hallucinate" the data property onto the parent object, skipping the unwrap.

## The Solution: Boundary Classes

Keep the Result pattern **internally** in handlers. Add a thin public class that calls the handler, checks the result, and throws a structured error on failure.

### 1. Define a structured error class

```typescript
// errors.ts
import type { CreateUserErrorCode } from "./methods/user/create/spec.js";

export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly recoverable: boolean,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
```

### 2. Internal handler (always returns Result)

```typescript
// methods/user/create/handler.ts — unchanged from the normal pattern
export class CreateUserHandler implements CreateUserSpec {
  async execute(input: CreateUserInput): Promise<CreateUserResult> {
    try {
      const user = await this.db.createUser(input);
      return { success: true, data: user };
    } catch (e) {
      return {
        success: false,
        error: { code: "UNKNOWN_ERROR", message: String(e), recoverable: false },
      };
    }
  }
}
```

### 3. Public class (unwraps and throws)

```typescript
// sdk.ts — the boundary
import { CreateUserHandler } from "./methods/user/create/handler.js";
import { CreateUserInputSchema } from "./methods/user/create/spec.js";
import { ServiceError } from "./errors.js";

export class UserService {
  private createUserHandler: CreateUserHandler;

  constructor(db: Database) {
    this.createUserHandler = new CreateUserHandler(db);
  }

  async createUser(email: string, name: string, role?: string): Promise<User> {
    // Parse at the boundary
    const input = CreateUserInputSchema.parse({ email, name, role });

    // Call the handler
    const result = await this.createUserHandler.execute(input);

    // Unwrap — throw on failure
    if (!result.success) {
      throw new ServiceError(
        result.error.code,
        result.error.message,
        result.error.recoverable,
        result.error.suggestion,
      );
    }

    return result.data;
  }
}
```

### 4. Consumer experience (clean)

```typescript
// What users write — idiomatic TypeScript
try {
  const user = await service.createUser("alice@example.com", "Alice");
  console.log(user.id);
} catch (error) {
  if (error instanceof ServiceError) {
    console.error(`[${error.code}] ${error.message}`);
    if (error.recoverable) {
      // retry logic
    }
  }
}
```

## Benefits

| Aspect | Without boundary | With boundary |
|---|---|---|
| **Internal rigor** | Result pattern, exhaustive errors | Same — unchanged |
| **Consumer API** | Must check `.success` + access `.data` | Clean `try/catch` with structured errors |
| **Agent friendliness** | Agents skip unwrap, hallucinate data | Agents write happy-path code (their strength) |
| **Error structure** | Preserved internally but lost at API surface | `ServiceError` carries code, message, recoverability |
| **Testing** | Handler tests use Result assertions | Public API tests use `expect().rejects.toThrow()` |

## Testing the Boundary

```typescript
import { describe, it, expect } from "vitest";
import { UserService } from "./sdk.js";
import { ServiceError } from "./errors.js";

describe("UserService boundary", () => {
  it("returns clean data on success", async () => {
    const service = new UserService(mockDb());
    const user = await service.createUser("a@b.com", "Alice");
    expect(user.id).toBeDefined();
    // No .success check, no .data unwrap
  });

  it("throws ServiceError with structured code on failure", async () => {
    const service = new UserService(mockDb({ failCreate: true }));
    await expect(service.createUser("a@b.com", "Alice"))
      .rejects
      .toThrow(ServiceError);
  });

  it("preserves error code through the boundary", async () => {
    const service = new UserService(mockDb({ duplicateEmail: true }));
    try {
      await service.createUser("exists@b.com", "Alice");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).code).toBe("EMAIL_ALREADY_EXISTS");
      expect((error as ServiceError).recoverable).toBe(true);
    }
  });
});
```

## When to use this pattern

- **Libraries and SDKs** — always. Consumers should never see Result types.
- **CLIs** — usually not needed. The CLI command handler is already the boundary — it reads the Result and formats output.
- **Internal services** — optional. If the caller is another handler, passing Results is fine.
