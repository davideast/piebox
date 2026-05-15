import { describe, it, expect, vi } from "vitest";
import { RunHandler } from "./handler.js";
import { SandboxManager } from "../../sandbox-manager.js";
import { fail, ok } from "../shared/result.js";
import type { ICloneService } from "../clone/spec.js";
import type { IPromptService } from "../prompt/spec.js";
import type { ICommitService } from "../commit/handler.js";
import type { IExportService } from "../export/spec.js";

describe("RunHandler", () => {
  it("returns clone error when clone fails", async () => {
    const cloneHandler = { execute: vi.fn().mockResolvedValue(fail("CLONE_FAILED", "Network error")) } as unknown as ICloneService;
    const promptHandler = {} as IPromptService;
    const commitHandler = {} as ICommitService;
    const exportHandler = {} as IExportService;
    const manager = { exists: vi.fn().mockResolvedValue(false) } as unknown as SandboxManager;

    const handler = new RunHandler(cloneHandler, promptHandler, commitHandler, exportHandler, manager);
    const result = await handler.execute({ prompt: "hello", url: "https://github.com/a/b", sandboxName: "test", continue: false, apply: false, verbose: false, quiet: false });
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CLONE_FAILED");
    }
  });

  it("orchestrates successful run", async () => {
    const cloneHandler = { execute: vi.fn().mockResolvedValue(ok({ sandboxName: "test" })) } as unknown as ICloneService;
    const promptHandler = { execute: vi.fn().mockResolvedValue(ok({ sandboxName: "test" })) } as unknown as IPromptService;
    const commitHandler = { execute: vi.fn().mockResolvedValue(ok({ sha: "123" })) } as unknown as ICommitService;
    const exportHandler = { execute: vi.fn().mockResolvedValue(ok({ filesWritten: 2, bytesWritten: 10, paths: [] })) } as unknown as IExportService;
    const manager = { exists: vi.fn().mockResolvedValue(false) } as unknown as SandboxManager;

    const handler = new RunHandler(cloneHandler, promptHandler, commitHandler, exportHandler, manager);
    const result = await handler.execute({ 
      prompt: "hello", 
      url: "https://github.com/a/b", 
      sandboxName: "test",
      commit: true,
      outPath: "./out",
      continue: false,
      apply: false,
      verbose: false,
      quiet: false,
    });
    
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.commitSha).toBe("123");
      expect(result.data.filesWritten).toBe(2);
    }
  });
});
