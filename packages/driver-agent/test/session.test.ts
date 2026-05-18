/**
 * Tests for `createSandboxedSession` — exercises the moved
 * server-side session factory with a faux LLM provider over an
 * in-memory sandbox. Mirrors the multi-turn behavior the playground
 * stress harness exercises (turn 1 prompts, turn 2 sees the prior
 * tool call's result in conversation history).
 *
 * Step 5 of the composable-sandbox migration plan
 * (`docs/investigations/G-migration.md`).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  registerFauxProvider,
  type FauxProviderRegistration,
} from "@earendil-works/pi-ai";
import { createSandboxedSession } from "../src/session.js";
import { loadSkillsFromVFS } from "../src/skills.js";
import { AuthStorage } from "../src/adapters/pi-coding-agent.js";
import { createVFS } from "piebox";

/** Build an in-memory AuthStorage that says the faux provider is
 *  already authenticated, so the agent loop doesn't try to prompt
 *  for credentials. */
function fauxAuth(provider: string): AuthStorage {
  return AuthStorage.inMemory({
    [provider]: { type: "api_key", key: "test-key" },
  });
}

describe("createSandboxedSession", () => {
  let faux: FauxProviderRegistration;

  beforeEach(() => {
    faux = registerFauxProvider({
      api: "test-api",
      provider: "test-provider",
      models: [{ id: "test-model" }],
    });
  });

  afterEach(() => {
    faux.unregister();
  });

  it("returns substrate + session shape (vfs, bash, sandbox, cwd, session)", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxText("ok")], { stopReason: "end_turn" }),
    ]);

    const result = await createSandboxedSession({
      model: faux.getModel(),
      seed: { "README.md": "# test" },
    });

    expect(result.session).toBeDefined();
    expect(result.vfs).toBeDefined();
    expect(result.bash).toBeDefined();
    expect(result.sandbox).toBeDefined();
    expect(result.cwd).toBe("/sandbox");
    expect(result.sandbox.cwd).toBe("/sandbox");
    expect(result.sandbox.fs).toBe(result.vfs);
    // The seed file made it into the VFS.
    const buf = result.vfs.readFileSync("/sandbox/README.md", "utf-8");
    const content = typeof buf === "string" ? buf : Buffer.from(buf as Uint8Array).toString("utf-8");
    expect(content).toBe("# test");
  });

  it("Layer 2 sandbox.runtime.run routes through the bash interpreter", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxText("ok")], { stopReason: "end_turn" }),
    ]);

    const { sandbox } = await createSandboxedSession({
      model: faux.getModel(),
      seed: { "hello.txt": "world" },
    });

    const r = await sandbox.runtime.run("cat hello.txt", { cwd: sandbox.cwd });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("world");
  });

  it("seed files land relative to cwd", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxText("ok")], { stopReason: "end_turn" }),
    ]);

    const { vfs } = await createSandboxedSession({
      model: faux.getModel(),
      cwd: "/work",
      seed: {
        "src/index.ts": "console.log('hi');",
        "package.json": '{"name":"x"}',
      },
    });

    expect(vfs.statSync("/work/src/index.ts").isFile()).toBe(true);
    expect(vfs.statSync("/work/package.json").isFile()).toBe(true);
  });

  it("reuses a caller-supplied vfs without dropping its files", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxText("ok")], { stopReason: "end_turn" }),
    ]);

    const vfs = createVFS({ moduleHooks: false });
    vfs.mkdirSync("/sandbox", { recursive: true });
    vfs.writeFileSync("/sandbox/preexisting.md", "kept");

    const result = await createSandboxedSession({
      model: faux.getModel(),
      vfs,
    });

    expect(result.vfs).toBe(vfs);
    const buf = result.vfs.readFileSync("/sandbox/preexisting.md", "utf-8");
    const content = typeof buf === "string" ? buf : Buffer.from(buf as Uint8Array).toString("utf-8");
    expect(content).toBe("kept");
  });

  it("drives a one-turn prompt to completion via the faux model", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxText("done")], { stopReason: "end_turn" }),
    ]);

    const { session } = await createSandboxedSession({
      model: faux.getModel(),
      authStorage: fauxAuth("test-provider"),
    });

    const events: unknown[] = [];
    session.subscribe((e: unknown) => events.push(e));

    await session.prompt("say hi");
    // Faux provider got at least one cycle.
    expect(faux.state.callCount).toBeGreaterThanOrEqual(1);
    // Events were emitted on the subscription.
    expect(events.length).toBeGreaterThan(0);
  });

  it("threads multi-turn history including tool calls", async () => {
    // Turn 1: model issues a write tool call, then ends the turn after
    // the tool result comes back. Turn 2: model issues a read tool call
    // that should see the write's content, then ends.
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxText("writing"),
          fauxToolCall(
            "write",
            { path: "/sandbox/note.txt", content: "first turn" },
            { id: "call-1" },
          ),
        ],
        { stopReason: "tool_use" },
      ),
      fauxAssistantMessage([fauxText("wrote it")], { stopReason: "end_turn" }),
      fauxAssistantMessage(
        [
          fauxText("reading"),
          fauxToolCall(
            "read",
            { path: "/sandbox/note.txt" },
            { id: "call-2" },
          ),
        ],
        { stopReason: "tool_use" },
      ),
      fauxAssistantMessage([fauxText("saw it")], { stopReason: "end_turn" }),
    ]);

    const { session, vfs } = await createSandboxedSession({
      model: faux.getModel(),
      authStorage: fauxAuth("test-provider"),
    });

    await session.prompt("write the file");
    // After turn 1, the file should exist in the VFS.
    const buf = vfs.readFileSync("/sandbox/note.txt", "utf-8");
    const content = typeof buf === "string" ? buf : Buffer.from(buf as Uint8Array).toString("utf-8");
    expect(content).toBe("first turn");

    await session.prompt("read the file");
    // Faux model should have been invoked across both turns.
    expect(faux.state.callCount).toBeGreaterThanOrEqual(3);
  });
});

describe("loadSkillsFromVFS", () => {
  it("discovers SKILL.md files from the VFS", () => {
    const vfs = createVFS({ moduleHooks: false });
    vfs.mkdirSync("/sandbox/.agents/skills/diataxis", { recursive: true });
    vfs.writeFileSync(
      "/sandbox/.agents/skills/diataxis/SKILL.md",
      [
        "---",
        "name: diataxis",
        "description: Diataxis docs framework",
        "---",
        "",
        "# Diataxis",
        "Use the four-quadrant model.",
      ].join("\n"),
    );

    const skills = loadSkillsFromVFS({
      vfs,
      dir: "/sandbox/.agents/skills",
    });

    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("diataxis");
    expect(skills[0]?.description).toContain("Diataxis");
  });

  it("returns empty list when the directory does not exist", () => {
    const vfs = createVFS({ moduleHooks: false });
    const skills = loadSkillsFromVFS({
      vfs,
      dir: "/nowhere/.agents/skills",
    });
    expect(skills).toEqual([]);
  });
});
