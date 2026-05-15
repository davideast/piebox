import { describe, it, expect } from "vitest";
import { PromptInputSchema } from "./spec.js";

describe("Prompt Spec", () => {
  it("validates input", () => {
    expect(PromptInputSchema.safeParse({ sandboxName: "test", prompt: "hello" }).success).toBe(true);
    expect(PromptInputSchema.safeParse({ sandboxName: "test", prompt: "" }).success).toBe(false);
  });
});
