import { describe, it, expect } from "vitest";
import { ok, fail } from "./result.js";

describe("Result", () => {
  it("creates an ok result", () => {
    const res = ok({ foo: "bar" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.foo).toBe("bar");
    }
  });

  it("creates a fail result", () => {
    const res = fail("ERROR_CODE", "Something went wrong");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe("ERROR_CODE");
      expect(res.error.message).toBe("Something went wrong");
    }
  });
});
