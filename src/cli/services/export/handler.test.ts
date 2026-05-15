import { describe, it, expect, vi } from "vitest";
import { ExportHandler } from "./handler.js";
import { SandboxManager } from "../../sandbox-manager.js";
import { sandbox } from "../../../sandbox.js";

describe("ExportHandler", () => {
  it("fails if sandbox not found", async () => {
    const manager = { exists: vi.fn().mockResolvedValue(false) } as unknown as SandboxManager;
    const handler = new ExportHandler(manager);
    const res = await handler.execute({ sandboxName: "test", outPath: "./out" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe("NOT_FOUND");
    }
  });

  it("exports files", async () => {
    const sb = sandbox();
    const exportResult = { filesWritten: 1, bytesWritten: 10, paths: ["out/a.txt"] };
    sb.export = vi.fn().mockResolvedValue(exportResult);
    
    const manager = {
      exists: vi.fn().mockResolvedValue(true),
      load: vi.fn().mockResolvedValue(sb),
    } as unknown as SandboxManager;

    const handler = new ExportHandler(manager);
    const res = await handler.execute({ sandboxName: "test", outPath: "./out" });
    
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual(exportResult);
    }
    expect(sb.export).toHaveBeenCalledWith("./out");
  });
});
