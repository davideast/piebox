import { describe, it, expect, vi } from "vitest";
import { PromptHandler } from "./handler.js";
import { SandboxManager } from "../../sandbox-manager.js";
import { sandbox } from "../../../sandbox.js";

vi.mock("../../utils/model-resolver.js", () => ({
  resolveModel: vi.fn().mockReturnValue({}),
}));

describe("PromptHandler", () => {
  it("fails if sandbox not found", async () => {
    const manager = { exists: vi.fn().mockResolvedValue(false) } as unknown as SandboxManager;
    const handler = new PromptHandler(manager);
    const res = await handler.execute({ sandboxName: "test", prompt: "hello" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.code).toBe("NOT_FOUND");
    }
  });

  it("loads, prompts, and saves", async () => {
    const sb = sandbox();
    const session = { prompt: vi.fn().mockResolvedValue(undefined) };
    sb.createSession = vi.fn().mockResolvedValue(session);
    
    const manager = {
      exists: vi.fn().mockResolvedValue(true),
      load: vi.fn().mockResolvedValue(sb),
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as SandboxManager;

    const handler = new PromptHandler(manager);
    const res = await handler.execute({ sandboxName: "test", prompt: "hello" });
    
    expect(res.success).toBe(true);
    expect(manager.load).toHaveBeenCalledWith("test");
    expect(sb.createSession).toHaveBeenCalled();
    expect(session.prompt).toHaveBeenCalledWith("hello");
    expect(manager.save).toHaveBeenCalledWith("test", sb);
  });
});
