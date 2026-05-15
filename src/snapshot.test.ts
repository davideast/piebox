import { describe, it, expect } from "vitest";
import { sandbox } from "./sandbox.js";

describe("sandbox snapshot", () => {
  it("returns a snapshot of the current VFS state", () => {
    const sb = sandbox();
    sb.fs.writeFileSync("/sandbox/hello.txt", "world");
    
    const snapshot = sb.snapshot();
    expect(snapshot.version).toBe(1);
    expect(snapshot.files).toContainEqual({
      path: "/sandbox/hello.txt",
      content: "world",
      encoding: "utf-8"
    });
  });
});