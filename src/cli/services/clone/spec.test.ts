import { describe, it, expect } from "vitest";
import { CloneInputSchema } from "./spec.js";

describe("Clone Spec", () => {
  it("validates input", () => {
    expect(CloneInputSchema.safeParse({ url: "https://github.com/a/b", sandboxName: "test" }).success).toBe(true);
    expect(CloneInputSchema.safeParse({ url: "invalid", sandboxName: "test" }).success).toBe(false);
  });
});
