import { describe, it, expect } from "vitest";
import { ExportInputSchema } from "./spec.js";

describe("Export Spec", () => {
  it("validates input", () => {
    expect(ExportInputSchema.safeParse({ sandboxName: "test", outPath: "./out" }).success).toBe(true);
    expect(ExportInputSchema.safeParse({ sandboxName: "test", outPath: "" }).success).toBe(false);
  });
});
