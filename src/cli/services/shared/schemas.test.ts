import { describe, it, expect } from "vitest";
import { SandboxNameSchema, GitUrlSchema, OutputPathSchema } from "./schemas.js";

describe("Schemas", () => {
  it("validates SandboxNameSchema", () => {
    expect(SandboxNameSchema.safeParse("valid-name_123").success).toBe(true);
    expect(SandboxNameSchema.safeParse("invalid name!").success).toBe(false);
  });

  it("validates GitUrlSchema", () => {
    expect(GitUrlSchema.safeParse("https://github.com/repo").success).toBe(true);
    expect(GitUrlSchema.safeParse("git@github.com:repo.git").success).toBe(false); // URL schema might reject ssh format without protocol if we use `.url()`. Actually `.url()` requires protocol.
    // We'll just test http for now
    expect(GitUrlSchema.safeParse("invalid-url").success).toBe(false);
  });

  it("validates OutputPathSchema", () => {
    expect(OutputPathSchema.safeParse("./out").success).toBe(true);
    expect(OutputPathSchema.safeParse("").success).toBe(false);
  });
});
