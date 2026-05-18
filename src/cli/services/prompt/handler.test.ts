import { describe, it, expect, vi } from "vitest";
import { PromptHandler } from "./handler.js";
import { SandboxManager } from "../../sandbox-manager.js";
import { sandbox } from "../../../sandbox.js";

vi.mock("../../utils/model-resolver.js", () => ({
  resolveModel: vi.fn().mockReturnValue({}),
}));

const sessionMock = { prompt: vi.fn().mockResolvedValue(undefined) };
const createSandboxedSessionMock = vi.fn().mockResolvedValue({ session: sessionMock });
vi.mock("@piebox/driver-agent/server", () => ({
  createSandboxedSession: (...args: unknown[]) => createSandboxedSessionMock(...args),
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
    createSandboxedSessionMock.mockClear();
    sessionMock.prompt.mockClear();

    const manager = {
      exists: vi.fn().mockResolvedValue(true),
      load: vi.fn().mockResolvedValue(sb),
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as SandboxManager;

    const handler = new PromptHandler(manager);
    const res = await handler.execute({ sandboxName: "test", prompt: "hello" });

    expect(res.success).toBe(true);
    expect(manager.load).toHaveBeenCalledWith("test");
    expect(createSandboxedSessionMock).toHaveBeenCalled();
    expect(sessionMock.prompt).toHaveBeenCalledWith("hello");
    expect(manager.save).toHaveBeenCalledWith("test", sb);
  });
});
