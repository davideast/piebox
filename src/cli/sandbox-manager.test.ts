import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SandboxManager } from "./sandbox-manager.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

describe("SandboxManager", () => {
  const testDir = ".piebox-test/sandboxes";
  const manager = new SandboxManager(testDir);

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(".piebox-test", { recursive: true, force: true });
  });

  it("creates, saves, loads, lists, and destroys", async () => {
    const sb1 = await manager.create("test-sandbox");
    expect(await manager.exists("test-sandbox")).toBe(true);
    
    sb1.fs.writeFileSync("/sandbox/test.txt", "hello");
    await manager.save("test-sandbox", sb1);
    
    const sb2 = await manager.load("test-sandbox");
    expect(sb2.fs.readFileSync("/sandbox/test.txt", "utf-8")).toBe("hello");

    const list = await manager.list();
    expect(list.length).toBe(1);
    expect(list[0]?.name).toBe("test-sandbox");

    await manager.destroy("test-sandbox");
    expect(await manager.exists("test-sandbox")).toBe(false);
  });
});
