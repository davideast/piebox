/**
 * Driver spike: `@piebox/driver-mcp`
 *
 * Exposes a piebox sandbox's toolset over the Model Context Protocol so
 * Claude Desktop / Cursor / any MCP-compatible client can drive it.
 *
 * This file is a SPIKE. It is supposed to fall through on compile any
 * time the Layer 2 contract is missing something. See the
 * "## Layer 2 gaps surfaced by this spike" block at the bottom.
 *
 * Compiles against `./layer2.d.ts` only. The MCP SDK is mocked with a
 * tiny stand-in interface declared at the top — we are testing whether
 * Layer 2 is *adequate*, not whether the wire protocol works.
 */

import type {
  Sandbox,
  PieboxToolset,
  PieboxTool,
  PieboxResult,
  RuntimeCapabilities,
} from "./layer2.d.ts";

// ─────────────────────────────────────────────────────────────────────
// Stand-in for @modelcontextprotocol/sdk. Mirror only what we use.
// ─────────────────────────────────────────────────────────────────────

interface McpToolListEntry {
  name: string;
  description: string;
  inputSchema: object;
}
interface McpToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
interface McpResourceListEntry {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}
interface McpResourceReadResult {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}
interface McpServer {
  setListToolsHandler(
    handler: () => Promise<{ tools: McpToolListEntry[] }>,
  ): void;
  setCallToolHandler(
    handler: (req: {
      name: string;
      arguments?: unknown;
    }) => Promise<McpToolCallResult>,
  ): void;
  // Resources are a separate MCP capability — see getCapabilitiesResource().
  setListResourcesHandler?(
    handler: () => Promise<{ resources: McpResourceListEntry[] }>,
  ): void;
  setReadResourceHandler?(
    handler: (req: { uri: string }) => Promise<McpResourceReadResult>,
  ): void;
  connect(transport: McpTransport): Promise<void>;
  close(): Promise<void>;
}
interface McpTransport {}
declare function createMcpServer(opts: {
  name: string;
  version: string;
}): McpServer;
declare function createStdioTransport(): McpTransport;

// ─────────────────────────────────────────────────────────────────────
// Result mapping
// ─────────────────────────────────────────────────────────────────────

const CAPABILITIES_URI = "piebox://sandbox/capabilities";

/**
 * Heuristic: is `data` small enough to inline as a second text block?
 * MCP doesn't define a size limit, so we cap at ~4KB of serialized JSON
 * to keep tool responses under the typical model-context budget. The
 * real driver would make this configurable.
 */
function dataIsInlinable(data: unknown): data is object {
  if (data == null) return false;
  try {
    const s = JSON.stringify(data);
    return s.length <= 4096;
  } catch {
    return false;
  }
}

function mapResultToMcp(result: PieboxResult): McpToolCallResult {
  const content: McpToolCallResult["content"] = [];
  if (result.summary) {
    content.push({ type: "text", text: result.summary });
  } else if (result.ok) {
    content.push({ type: "text", text: "(ok)" });
  } else {
    content.push({ type: "text", text: "(tool failed without summary)" });
  }

  if (dataIsInlinable(result.data)) {
    content.push({
      type: "text",
      text: "```json\n" + JSON.stringify(result.data, null, 2) + "\n```",
    });
  }

  // isError when the tool reported failure OR when data carries a non-zero
  // exit code. PieboxResult.data is typed as `unknown`, so we narrow
  // defensively — this is the kind of check we'd want a helper for.
  // TODO: layer2 missing — there's no standard shape for "exit code in data".
  // The bash tool's `data` happens to include `exitCode`, but PieboxResult
  // has no typed accessor for it. Drivers end up duck-typing.
  let exitNonZero = false;
  const d = result.data as { exitCode?: unknown } | undefined;
  if (d && typeof d.exitCode === "number" && d.exitCode !== 0) {
    exitNonZero = true;
  }

  const isError = result.ok === false || exitNonZero;
  return isError ? { content, isError: true } : { content };
}

// ─────────────────────────────────────────────────────────────────────
// Capability resource
// ─────────────────────────────────────────────────────────────────────

/**
 * Why a *resource* and not in tool descriptions:
 *
 * MCP clients template tool descriptions into model prompts on every
 * turn. Embedding the full capability blob (binaries list, persistence,
 * etc.) into every tool's description bloats the prompt and duplicates
 * data across N tools. A resource is read once by the host (Claude
 * Desktop reads resources on session start) and made available
 * separately. The host can decide when to splice it into context.
 *
 * It also lets the client distinguish "what tools exist" from "what the
 * sandbox can do" — the former changes when the toolset changes, the
 * latter when the runtime changes. Different cache lifetimes.
 */
function buildCapabilitiesResource(
  caps: RuntimeCapabilities,
): McpResourceReadResult {
  // Plain JSON. RuntimeCapabilities is already serializable by design
  // (no functions, no symbols). availableBinaries is readonly string[]
  // which JSON.stringify handles fine — see Investigation E open Q #1.
  const payload = {
    fileSystem: caps.fileSystem,
    processModel: caps.processModel,
    realNetwork: caps.realNetwork,
    nativeAddons: caps.nativeAddons,
    availableBinaries: [...caps.availableBinaries],
    interactiveTty: caps.interactiveTty,
    persistence: caps.persistence,
  };
  return {
    contents: [
      {
        uri: CAPABILITIES_URI,
        mimeType: "application/json",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Driver
// ─────────────────────────────────────────────────────────────────────

export interface McpDriverOptions {
  sandbox: Sandbox;
  toolset: PieboxToolset;
  serverName?: string;
}

export interface McpDriver {
  start(transport?: McpTransport): Promise<void>;
  stop(): Promise<void>;
  /** Exposed for tests / programmatic introspection. */
  getCapabilitiesResource(): McpResourceReadResult;
}

export function createMcpDriver(opts: McpDriverOptions): McpDriver {
  const { sandbox, toolset } = opts;
  const serverName = opts.serverName ?? "piebox";

  const server = createMcpServer({ name: serverName, version: "0.0.0" });
  const byName = new Map<string, PieboxTool>();
  for (const t of toolset.tools) byName.set(t.name, t);

  // In-flight call signals so stop() can cancel them. MCP itself has a
  // `notifications/cancelled` message, but the stand-in doesn't model
  // that — see the gaps block.
  const inflight = new Set<AbortController>();

  return {
    getCapabilitiesResource() {
      return buildCapabilitiesResource(sandbox.runtime.capabilities);
    },

    async start(transport?: McpTransport) {
      // MCP tools return a single result — no streaming primitive.
      // (Contrast with the agent driver spike C.1, which calls
      // `tool.executeStreaming?.(...)` to surface chunks to the user.)
      // If MCP ever adds a streaming-content extension, this is where
      // we'd branch.
      server.setListToolsHandler(async () => ({
        tools: toolset.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      }));

      server.setCallToolHandler(async (req) => {
        const tool = byName.get(req.name);
        if (!tool) {
          return {
            content: [{ type: "text", text: `Unknown tool: ${req.name}` }],
            isError: true,
          };
        }

        const ac = new AbortController();
        inflight.add(ac);
        try {
          const result = await tool.execute(req.arguments, sandbox, ac.signal);
          return mapResultToMcp(result);
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Tool ${req.name} threw: ${(err as Error)?.message ?? String(err)}`,
              },
            ],
            isError: true,
          };
        } finally {
          inflight.delete(ac);
        }
      });

      // Resources: capabilities only, for now.
      server.setListResourcesHandler?.(async () => ({
        resources: [
          {
            uri: CAPABILITIES_URI,
            name: "Sandbox capabilities",
            description:
              "Static description of what this piebox sandbox runtime can do.",
            mimeType: "application/json",
          },
        ],
      }));
      server.setReadResourceHandler?.(async (req) => {
        if (req.uri !== CAPABILITIES_URI) {
          // spec gap: MCP doesn't standardize "resource not found" error
          // shape; some hosts expect an exception, some a contents-empty
          // result. We throw and let the SDK translate.
          throw new Error(`Unknown resource: ${req.uri}`);
        }
        return buildCapabilitiesResource(sandbox.runtime.capabilities);
      });

      await server.connect(transport ?? createStdioTransport());
    },

    async stop() {
      for (const ac of inflight) ac.abort();
      inflight.clear();
      await server.close();
      sandbox.destroy();
    },
  };
}

/*
## Layer 2 gaps surfaced by this spike

1. **No serializable view of `RuntimeCapabilities`.** The interface is
   already plain-data, but every driver that exposes it externally
   (agent prompt, MCP resource, CLI `--caps`) re-implements the same
   `{...caps, availableBinaries: [...caps.availableBinaries]}` defensive
   copy. Suggest piebox export a `capabilitiesToJSON(caps)` helper, or
   constrain `availableBinaries` to `readonly string[]` AND document
   that the whole object is JSON-safe so consumers can `JSON.stringify`
   directly. (E open Q #1 hinted at this.)

2. **No typed `exitCode` on `PieboxResult`.** The MCP `isError` mapping
   has to duck-type `result.data.exitCode` to know whether a bash
   invocation failed despite `ok: true`. Either:
   (a) lift `exitCode?: number` to the top level of `PieboxResult`, or
   (b) introduce a `PieboxProcessResult` subtype that bash-family tools
   return and which other tools don't.
   Without this, every driver re-derives the same check.

3. **No cancellation protocol from driver → in-flight tool.** MCP's
   `notifications/cancelled` needs to map to aborting the corresponding
   `tool.execute` call. We solved it locally with an `AbortController`
   per call, but Layer 2 doesn't define how the driver tracks which
   signal belongs to which call-id. The agent driver has the same
   problem. Suggest a `Sandbox.runningCalls` registry or a documented
   pattern.

4. **No way to enumerate available toolsets / multiple sandboxes.**
   `createMcpDriver` takes ONE `sandbox` and ONE `toolset`. An MCP
   server commonly fronts multiple sessions (one per chat). Layer 2
   has no notion of a sandbox pool or naming/addressing scheme for
   multi-sandbox drivers. The session-pool driver from E Table 2 will
   hit this harder.

5. **No metadata on tools beyond `name` / `description` / `inputSchema`.**
   MCP supports per-tool annotations (`readOnlyHint`, `destructiveHint`,
   `idempotentHint`, `openWorldHint`) that improve client UX (Claude
   Desktop dims destructive tools). Layer 2's `PieboxTool` has no
   place for these hints. They could live as an optional
   `annotations?: { readOnly?: boolean; destructive?: boolean; ... }`.

6. **No output-schema on tools.** MCP recently added `outputSchema` so
   clients can validate / pretty-print structured results. Layer 2
   types `PieboxTool` with a `Data` generic but doesn't expose the
   shape. Driver authors can't forward a schema they don't have.

7. **Resources are entirely absent from Layer 2.** This spike invents
   `buildCapabilitiesResource` locally. Other plausible resources
   (file tree at `sandbox.cwd`, git log, environment variables) would
   all be one-off ad-hoc maps from Sandbox state to MCP resources.
   Suggest a small `PieboxResource` interface paralleling `PieboxTool`,
   so drivers don't reinvent the wiring.

8. **No way to react to sandbox lifecycle events.** If the sandbox is
   destroyed externally (e.g. the host tab closes the IndexedDB),
   the MCP driver should notify clients via
   `notifications/tools/list_changed` or shut down. `Sandbox.destroy`
   has no "on-destroyed" hook to subscribe to.

9. **`PieboxResult.summary` is optional but MCP requires non-empty
   content.** We compensated with placeholders ("(ok)", "(tool failed
   without summary)"). Either `summary` should be required, or the
   contract should state "drivers may substitute a default when
   absent" so we know it's not a bug.
*/
