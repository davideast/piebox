import { describe, it, expect, vi } from "vitest";
import { CloneHandler } from "./handler.js";
import { SandboxManager } from "../../sandbox-manager.js";
import { sandbox } from "../../../sandbox.js";

describe("CloneHandler", () => {
  it("fails on invalid input", async () => {
    const manager = {} as SandboxManager;
    const handler = new CloneHandler(manager);
    const res = await handler.execute({ url: "invalid", sandboxName: "test" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe("INVALID_INPUT");
    }
  });

  it("fails if sandbox already exists", async () => {
    const manager = { exists: vi.fn().mockResolvedValue(true) } as unknown as SandboxManager;
    const handler = new CloneHandler(manager);
    const res = await handler.execute({ url: "https://github.com/a/b", sandboxName: "test" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe("ALREADY_EXISTS");
    }
  });

  it("clones and saves", async () => {
    const sb = sandbox();
    sb.clone = vi.fn().mockResolvedValue(undefined);
    const manager = {
      exists: vi.fn().mockResolvedValue(false),
      create: vi.fn().mockResolvedValue(sb),
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as SandboxManager;

    const handler = new CloneHandler(manager);
    const res = await handler.execute({ url: "https://github.com/a/b", sandboxName: "test" });
    
    expect(res.success).toBe(true);
    expect(manager.create).toHaveBeenCalledWith("test", "https://github.com/a/b");
    expect(sb.clone).toHaveBeenCalledWith({ url: "https://github.com/a/b" });
    expect(manager.save).toHaveBeenCalledWith("test", sb);
  });

  it("destroys on clone failure", async () => {
    const sb = sandbox();
    sb.clone = vi.fn().mockRejectedValue(new Error("Network error"));
    const manager = {
      exists: vi.fn().mockResolvedValue(false),
      create: vi.fn().mockResolvedValue(sb),
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as SandboxManager;

    const handler = new CloneHandler(manager);
    const res = await handler.execute({ url: "https://github.com/a/b", sandboxName: "test" });
    
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe("CLONE_FAILED");
    }
    expect(manager.destroy).toHaveBeenCalledWith("test");
  });
});
