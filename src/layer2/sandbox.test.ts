/**
 * End-to-end + invariant tests for the Layer 2 sandbox primitive.
 *
 * Three concerns covered, matching Step 3's verification spec:
 *   1. A sandbox + standard toolset can read/write/bash end-to-end
 *      over an in-memory PieboxFS.
 *   2. `on('destroyed', h)` fires `h` exactly once; subsequent
 *      `destroy()` calls are no-ops (idempotency — gap G3 from C).
 *   3. `PieboxResult.exitCode` is set by the bash tool on both
 *      success and failure; undefined for non-process tools
 *      (gap G1 from C).
 */
import { describe, it, expect } from "vitest";
import { createNodeFs } from "../fs/node-backend.js";
import type { PieboxRuntime } from "../runtime/types.js";
import { createSandbox } from "./sandbox.js";
import { createStandardToolset } from "./standard-toolset.js";
import { BROWSER_CAPABILITIES } from "./capabilities.js";

// ── Test runtime ────────────────────────────────────────────────────────
// A minimal PieboxRuntime double — the standard toolset's bash tool
// hits this through `sandbox.runtime.run`. The double executes a
// scripted table: `command → result`.

function testRuntime(
  scripts: Record<string, { stdout: string; stderr: string; exitCode: number }>,
): PieboxRuntime {
  return {
    async run(cmd) {
      const entry = scripts[cmd];
      if (!entry) {
        return { stdout: "", stderr: `unknown command: ${cmd}\n`, exitCode: 127 };
      }
      return entry;
    },
  };
}

// ── Test helpers ────────────────────────────────────────────────────────

function freshSandbox(scripts: Parameters<typeof testRuntime>[0] = {}) {
  const fs = createNodeFs();
  fs.mkdirSync("/work", { recursive: true });
  return createSandbox({
    fs,
    runtime: testRuntime(scripts),
    capabilities: BROWSER_CAPABILITIES,
    cwd: "/work",
  });
}

// ── 1. End-to-end ───────────────────────────────────────────────────────

describe("sandbox end-to-end with standard toolset", () => {
  it("write + read round-trip", async () => {
    const sandbox = freshSandbox();
    const toolset = createStandardToolset(sandbox);
    const signal = new AbortController().signal;

    const writeRes = await toolset.get("write")!.execute(
      { path: "note.txt", content: "hello layer 2" },
      sandbox,
      signal,
    );
    expect(writeRes.ok).toBe(true);

    const readRes = await toolset.get("read")!.execute(
      { path: "note.txt" },
      sandbox,
      signal,
    );
    expect(readRes.ok).toBe(true);
    expect((readRes.data as { content: string }).content).toBe("hello layer 2");
  });

  it("ls returns entries from cwd when path omitted", async () => {
    const sandbox = freshSandbox();
    const toolset = createStandardToolset(sandbox);
    const signal = new AbortController().signal;

    await toolset.get("write")!.execute(
      { path: "a.txt", content: "1" },
      sandbox,
      signal,
    );
    await toolset.get("write")!.execute(
      { path: "b.txt", content: "2" },
      sandbox,
      signal,
    );

    const res = await toolset.get("ls")!.execute({}, sandbox, signal);
    expect(res.ok).toBe(true);
    const entries = (res.data as { entries: string[] }).entries;
    expect(entries.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("bash routes through runtime.run and returns its result", async () => {
    const sandbox = freshSandbox({
      "echo hi": { stdout: "hi\n", stderr: "", exitCode: 0 },
    });
    const toolset = createStandardToolset(sandbox);
    const signal = new AbortController().signal;

    const res = await toolset.get("bash")!.execute(
      { command: "echo hi" },
      sandbox,
      signal,
    );
    expect(res.ok).toBe(true);
    expect(res.summary).toBe("exit=0");
    expect((res.data as { stdout: string }).stdout).toBe("hi\n");
  });
});

// ── 2. Lifecycle: on('destroyed') idempotency (G3) ──────────────────────

describe("sandbox lifecycle", () => {
  it("'destroyed' fires exactly once on first destroy()", () => {
    const sandbox = freshSandbox();
    let count = 0;
    sandbox.on("destroyed", () => {
      count++;
    });
    sandbox.destroy();
    expect(count).toBe(1);
    sandbox.destroy();
    sandbox.destroy();
    expect(count).toBe(1);
  });

  it("multiple handlers all fire", () => {
    const sandbox = freshSandbox();
    let a = 0, b = 0;
    sandbox.on("destroyed", () => {
      a++;
    });
    sandbox.on("destroyed", () => {
      b++;
    });
    sandbox.destroy();
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it("a thrown handler does not block other handlers", () => {
    const sandbox = freshSandbox();
    let fired = false;
    sandbox.on("destroyed", () => {
      throw new Error("boom");
    });
    sandbox.on("destroyed", () => {
      fired = true;
    });
    sandbox.destroy();
    expect(fired).toBe(true);
  });

  it("dispose() removes a handler before destroy fires", () => {
    const sandbox = freshSandbox();
    let count = 0;
    const sub = sandbox.on("destroyed", () => {
      count++;
    });
    sub.dispose();
    sandbox.destroy();
    expect(count).toBe(0);
  });

  it("post-destroy toTarball rejects", async () => {
    const sandbox = freshSandbox();
    sandbox.destroy();
    await expect(sandbox.toTarball()).rejects.toThrow(/destroyed/);
  });
});

// ── 3. PieboxResult.exitCode invariants (G1) ────────────────────────────

describe("PieboxResult.exitCode", () => {
  it("bash sets exitCode on success", async () => {
    const sandbox = freshSandbox({
      "true": { stdout: "", stderr: "", exitCode: 0 },
    });
    const toolset = createStandardToolset(sandbox);
    const res = await toolset.get("bash")!.execute(
      { command: "true" },
      sandbox,
      new AbortController().signal,
    );
    expect(res.exitCode).toBe(0);
    expect(res.ok).toBe(true);
  });

  it("bash sets exitCode on failure", async () => {
    const sandbox = freshSandbox({
      "false": { stdout: "", stderr: "", exitCode: 1 },
    });
    const toolset = createStandardToolset(sandbox);
    const res = await toolset.get("bash")!.execute(
      { command: "false" },
      sandbox,
      new AbortController().signal,
    );
    expect(res.exitCode).toBe(1);
    expect(res.ok).toBe(false);
  });

  it("non-process tools leave exitCode undefined", async () => {
    const sandbox = freshSandbox();
    const toolset = createStandardToolset(sandbox);
    const signal = new AbortController().signal;

    const writeRes = await toolset.get("write")!.execute(
      { path: "x.txt", content: "1" },
      sandbox,
      signal,
    );
    expect(writeRes.exitCode).toBeUndefined();
    expect(writeRes.ok).toBe(true);

    const readRes = await toolset.get("read")!.execute(
      { path: "x.txt" },
      sandbox,
      signal,
    );
    expect(readRes.exitCode).toBeUndefined();
  });

  it("driver-canonical failed check works in both shapes", () => {
    const failed = (r: { ok: boolean; exitCode?: number }) =>
      r.exitCode === undefined ? !r.ok : r.exitCode !== 0;

    expect(failed({ ok: true })).toBe(false);
    expect(failed({ ok: false })).toBe(true);
    expect(failed({ ok: true, exitCode: 0 })).toBe(false);
    expect(failed({ ok: false, exitCode: 1 })).toBe(true);
    // The interesting edge: process said exitCode=0 (success) but
    // some caller flipped ok to false. We trust exitCode.
    expect(failed({ ok: false, exitCode: 0 })).toBe(false);
  });
});

// ── 4. Toolset invariants ───────────────────────────────────────────────

describe("PieboxToolset", () => {
  it("get(name) finds a tool, unknown returns undefined", () => {
    const sandbox = freshSandbox();
    const toolset = createStandardToolset(sandbox);
    expect(toolset.get("read")?.name).toBe("read");
    expect(toolset.get("nonexistent")).toBeUndefined();
  });

  it("standard toolset exposes the expected 7 tools", () => {
    const sandbox = freshSandbox();
    const toolset = createStandardToolset(sandbox);
    const names = toolset.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "bash",
      "edit",
      "find",
      "grep",
      "ls",
      "read",
      "write",
    ]);
  });
});
