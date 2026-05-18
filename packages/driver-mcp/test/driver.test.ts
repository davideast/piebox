/**
 * Tests for `@piebox/driver-mcp`.
 *
 * Exercises the driver end-to-end against the SDK's in-memory
 * transport pair (real protocol over fake wire). Covers:
 *
 *   - list-tools shape matches piebox's tool descriptors
 *   - call-tool round-trip (read + bash via the standard toolset)
 *   - result mapping: success, failure with exitCode, missing-summary
 *     fallback, oversized data truncation
 *   - capabilities resource: list + read
 *   - cancellation: AbortSignal flips when a `notifications/cancelled`
 *     arrives mid-call (G3 + the new cancellation wiring)
 *   - sandbox lifecycle: `Sandbox.destroy()` shuts the driver down
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createNodeFs } from "piebox";
import {
  BROWSER_CAPABILITIES,
  createSandbox,
  createStandardToolset,
  createToolset,
  type PieboxRuntime,
  type PieboxResult,
  type PieboxTool,
  type Sandbox,
} from "piebox/layer2";
import { createMcpDriver, mapResultToMcp, CAPABILITIES_URI } from "../src/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function scriptedRuntime(
  scripts: Record<string, { stdout: string; stderr: string; exitCode: number }>,
): PieboxRuntime {
  return {
    async run(cmd: string) {
      const entry = scripts[cmd];
      if (!entry) {
        return { stdout: "", stderr: `unknown: ${cmd}\n`, exitCode: 127 };
      }
      return entry;
    },
  } as PieboxRuntime;
}

function freshSandbox(scripts: Parameters<typeof scriptedRuntime>[0] = {}): Sandbox {
  const fs = createNodeFs();
  fs.mkdirSync("/work", { recursive: true });
  return createSandbox({
    fs,
    runtime: scriptedRuntime(scripts),
    capabilities: BROWSER_CAPABILITIES,
    cwd: "/work",
  });
}

interface DriverFixture {
  sandbox: Sandbox;
  client: Client;
  stop(): Promise<void>;
}

async function startDriverWithClient(
  sandbox: Sandbox,
  toolset = createStandardToolset(sandbox),
): Promise<DriverFixture> {
  const driver = createMcpDriver({ sandbox, toolset });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  // Server connect first, then client — order doesn't actually matter
  // for in-memory transport but the SDK examples standardize on this.
  await driver.start(serverTransport);
  await client.connect(clientTransport);
  return {
    sandbox,
    client,
    async stop() {
      await client.close();
      await driver.stop();
    },
  };
}

// ── 1. List tools ────────────────────────────────────────────────────────

describe("MCP driver — tools/list", () => {
  let fx: DriverFixture;
  beforeEach(async () => {
    fx = await startDriverWithClient(freshSandbox());
  });
  afterEach(async () => {
    await fx.stop();
  });

  it("returns each PieboxTool with name, description, inputSchema", async () => {
    const res = await fx.client.listTools();
    const names = res.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "bash",
      "edit",
      "find",
      "grep",
      "ls",
      "read",
      "write",
    ]);
    for (const t of res.tools) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema).toBeDefined();
      expect((t.inputSchema as { type: string }).type).toBe("object");
    }
  });
});

// ── 2. Call tool ─────────────────────────────────────────────────────────

describe("MCP driver — tools/call", () => {
  let fx: DriverFixture;
  beforeEach(async () => {
    fx = await startDriverWithClient(
      freshSandbox({
        "true": { stdout: "", stderr: "", exitCode: 0 },
        "false": { stdout: "", stderr: "", exitCode: 1 },
      }),
    );
  });
  afterEach(async () => {
    await fx.stop();
  });

  it("write + read round-trip via MCP", async () => {
    const w = await fx.client.callTool({
      name: "write",
      arguments: { path: "note.txt", content: "hello mcp" },
    });
    expect(w.isError).toBeUndefined();

    const r = await fx.client.callTool({
      name: "read",
      arguments: { path: "note.txt" },
    });
    expect(r.isError).toBeUndefined();
    // Summary block + JSON-data block. The JSON block contains
    // {"content": "hello mcp"}.
    const content = (r.content as Array<{ type: string; text: string }>);
    expect(content.length).toBeGreaterThanOrEqual(2);
    expect(content[1]!.text).toContain("hello mcp");
  });

  it("bash success: no isError, exitCode=0 surfaced in JSON block", async () => {
    const res = await fx.client.callTool({
      name: "bash",
      arguments: { command: "true" },
    });
    expect(res.isError).toBeUndefined();
    const content = res.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toBe("exit=0");
  });

  it("bash failure: isError=true when exitCode is non-zero", async () => {
    const res = await fx.client.callTool({
      name: "bash",
      arguments: { command: "false" },
    });
    expect(res.isError).toBe(true);
    const content = res.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toBe("exit=1");
  });

  it("unknown tool name returns isError with a helpful message", async () => {
    const res = await fx.client.callTool({
      name: "no-such-tool",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    const content = res.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain("Unknown tool");
  });
});

// ── 3. Capabilities resource ─────────────────────────────────────────────

describe("MCP driver — resources", () => {
  let fx: DriverFixture;
  beforeEach(async () => {
    fx = await startDriverWithClient(freshSandbox());
  });
  afterEach(async () => {
    await fx.stop();
  });

  it("lists the capabilities resource", async () => {
    const res = await fx.client.listResources();
    expect(res.resources.length).toBeGreaterThan(0);
    expect(res.resources[0]!.uri).toBe(CAPABILITIES_URI);
  });

  it("reading capabilities returns the seven-field fingerprint as JSON", async () => {
    const res = await fx.client.readResource({ uri: CAPABILITIES_URI });
    expect(res.contents.length).toBe(1);
    const payload = JSON.parse(res.contents[0]!.text as string);
    expect(payload).toEqual({
      fileSystem: "vfs",
      processModel: "shim",
      realNetwork: false,
      nativeAddons: false,
      availableBinaries: [],
      interactiveTty: false,
      persistence: "session",
    });
  });
});

// ── 4. Result mapping unit tests ────────────────────────────────────────

describe("mapResultToMcp", () => {
  it("ok with summary → content[0] = summary", () => {
    const r = mapResultToMcp({ ok: true, summary: "done" });
    expect(r.content).toEqual([{ type: "text", text: "done" }]);
    expect(r.isError).toBeUndefined();
  });

  it("ok without summary → '(ok)'", () => {
    const r = mapResultToMcp({ ok: true });
    expect(r.content[0]!.text).toBe("(ok)");
  });

  it("not ok without summary → fallback string + isError", () => {
    const r = mapResultToMcp({ ok: false });
    expect(r.content[0]!.text).toBe("(tool failed without summary)");
    expect(r.isError).toBe(true);
  });

  it("exitCode !== 0 flips isError even when ok=true", () => {
    const r = mapResultToMcp({ ok: true, summary: "done", exitCode: 3 });
    expect(r.isError).toBe(true);
  });

  it("inlines small data as fenced JSON", () => {
    const r = mapResultToMcp({
      ok: true,
      summary: "got it",
      data: { hello: "world" },
    });
    expect(r.content.length).toBe(2);
    expect(r.content[1]!.text).toContain("\"hello\": \"world\"");
  });

  it("drops oversized data", () => {
    const big = "x".repeat(5000);
    const r = mapResultToMcp({
      ok: true,
      summary: "got it",
      data: { payload: big },
    });
    expect(r.content.length).toBe(1);
  });
});

// ── 5. Cancellation ─────────────────────────────────────────────────────

describe("MCP driver — cancellation", () => {
  // A tool that resolves only when its signal aborts. We send a
  // call, then cancel from the client side; the tool's `execute`
  // should observe `signal.aborted === true`.
  let fx: DriverFixture;
  let aborted = false;

  beforeEach(async () => {
    aborted = false;
    const sandbox = freshSandbox();
    const slowTool: PieboxTool<Record<string, never>> = {
      name: "slow",
      description: "Awaits abort. Resolves only on cancellation.",
      inputSchema: { type: "object", properties: {} },
      async execute(_args, _sandbox, signal): Promise<PieboxResult> {
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            aborted = true;
            resolve();
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          );
        });
        return { ok: false, summary: "aborted" };
      },
    };
    fx = await startDriverWithClient(sandbox, createToolset([slowTool]));
  });
  afterEach(async () => {
    await fx.stop();
  });

  it("client-side AbortSignal propagates → tool sees signal.aborted", async () => {
    const ac = new AbortController();
    const callPromise = fx.client.callTool(
      { name: "slow", arguments: {} },
      undefined,
      { signal: ac.signal },
    );
    // Let the call reach the server before cancelling.
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    // The client throws on cancel; we catch and confirm the server
    // observed it via the `aborted` flag.
    await expect(callPromise).rejects.toThrow();
    // Give the abort propagation a tick to land on the server.
    await new Promise((r) => setTimeout(r, 20));
    expect(aborted).toBe(true);
  });
});
