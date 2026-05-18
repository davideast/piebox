/**
 * `@piebox/driver-mcp` — Model Context Protocol driver for piebox.
 *
 * Exposes a piebox `Sandbox` + `PieboxToolset` over MCP so Claude
 * Desktop / Cursor / any MCP-compatible client can drive the sandbox.
 *
 * Implementation notes:
 *   - Uses the LOW-LEVEL `Server` class (not `McpServer`) so we can
 *     pass piebox-native `PieboxToolSchema` objects (plain JSON
 *     Schema) directly as each tool's `inputSchema`, without having
 *     to convert to / from zod.
 *   - `notifications/cancelled` from the client → `AbortController.abort()`
 *     on the in-flight tool call. Each call gets its own controller;
 *     the driver tracks them by MCP request id so cancellation lines
 *     up with the original call.
 *   - `Sandbox.on('destroyed', ...)` (Layer 2 lifecycle hook from
 *     C-synthesis gap G3) is wired here: if something destroys the
 *     sandbox externally, the driver issues `tools/list_changed` and
 *     closes the server.
 *
 * Spec source: `docs/investigations/G-migration.md` Step 6.
 * Spike that this implementation follows:
 * `docs/investigations/C-driver-spikes/mcp-driver.ts`.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  CancelledNotificationSchema,
  type CallToolResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { Sandbox, PieboxTool, PieboxToolset } from "piebox/layer2";
import {
  buildCapabilitiesResource,
  CAPABILITIES_DESCRIPTION,
  CAPABILITIES_MIME_TYPE,
  CAPABILITIES_NAME,
  CAPABILITIES_URI,
} from "./capabilities-resource.js";
import { mapResultToMcp } from "./result-mapping.js";

// ── Public surface ───────────────────────────────────────────────────────

export interface McpDriverOptions {
  sandbox: Sandbox;
  toolset: PieboxToolset;
  /** Server `name` field advertised to MCP clients. Defaults to
   *  `"piebox"`. Customize per deployment (e.g. `"piebox-staging"`)
   *  when multiple piebox servers can coexist in one client config. */
  serverName?: string;
  /** Server `version` field. Defaults to the package version. */
  serverVersion?: string;
  /** Per-tool inline-data budget for the result mapper. See
   *  `result-mapping.ts`. */
  inlineDataBudgetBytes?: number;
}

export interface McpDriver {
  /** Connect the underlying server to a transport and start serving.
   *  Resolves when the transport is connected; the server keeps
   *  running until `stop()` is called or the transport closes. */
  start(transport: Transport): Promise<void>;
  /** Abort all in-flight tool calls (best-effort, via the signals
   *  passed to each `tool.execute`), close the server, then destroy
   *  the sandbox. Idempotent. */
  stop(): Promise<void>;
  /** Programmatic access to the underlying SDK `Server`. Exposed for
   *  advanced consumers that want to attach extra request handlers
   *  or send custom notifications. Most users should not need this. */
  readonly server: Server;
}

export { mapResultToMcp } from "./result-mapping.js";
export type {
  McpToolCallResult,
  McpContentBlock,
  MapResultOptions,
} from "./result-mapping.js";
export {
  buildCapabilitiesResource,
  renderCapabilitiesPayload,
  CAPABILITIES_URI,
} from "./capabilities-resource.js";

// ── Factory ──────────────────────────────────────────────────────────────

const SERVER_DEFAULT_NAME = "piebox";
const SERVER_DEFAULT_VERSION = "0.1.0";

export function createMcpDriver(opts: McpDriverOptions): McpDriver {
  const { sandbox, toolset } = opts;
  const serverName = opts.serverName ?? SERVER_DEFAULT_NAME;
  const serverVersion = opts.serverVersion ?? SERVER_DEFAULT_VERSION;
  const inlineBudget = opts.inlineDataBudgetBytes;

  // Build the underlying server. Advertise tools + resources
  // capabilities so MCP hosts know to query them.
  const server = new Server(
    { name: serverName, version: serverVersion },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: {},
      },
    },
  );

  // Tool dispatch index. Built once from the toolset's `.tools` array;
  // we don't call `toolset.get(name)` per request because the toolset
  // contract allows arbitrary `.get` implementations, and we want a
  // deterministic in-driver fallback for unknown names.
  const toolsByName = new Map<string, PieboxTool>();
  for (const t of toolset.tools) toolsByName.set(t.name, t);

  // In-flight call tracking. Keyed by the MCP request id so a
  // `notifications/cancelled` for that id can abort the right call.
  const inFlight = new Map<string | number, AbortController>();

  let stopped = false;
  let sandboxDestroyedListener: { dispose(): void } | null = null;

  // ── Request handlers ───────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolset.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req, extra): Promise<CallToolResult> => {
    const tool = toolsByName.get(req.params.name);
    if (!tool) {
      return {
        content: [
          { type: "text" as const, text: `Unknown tool: ${req.params.name}` },
        ],
        isError: true,
      };
    }

    const ac = new AbortController();
    const requestId = extra.requestId;
    inFlight.set(requestId, ac);
    // Tie the SDK's per-request abort signal to ours so the underlying
    // transport's cancellation (`extra.signal`) also aborts the tool.
    const onExtraAbort = () => ac.abort();
    extra.signal.addEventListener("abort", onExtraAbort, { once: true });

    try {
      const result = await tool.execute(
        req.params.arguments ?? {},
        sandbox,
        ac.signal,
      );
      // mapResultToMcp returns piebox-native McpToolCallResult; cast
      // to the SDK's structural CallToolResult (it adds an index
      // signature for forward-compatible fields like `_meta`).
      return mapResultToMcp(
        result,
        inlineBudget !== undefined
          ? { inlineDataBudgetBytes: inlineBudget }
          : {},
      ) as CallToolResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text" as const,
            text: `Tool '${req.params.name}' threw: ${msg}`,
          },
        ],
        isError: true,
      };
    } finally {
      extra.signal.removeEventListener("abort", onExtraAbort);
      inFlight.delete(requestId);
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: CAPABILITIES_URI,
        name: CAPABILITIES_NAME,
        description: CAPABILITIES_DESCRIPTION,
        mimeType: CAPABILITIES_MIME_TYPE,
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req): Promise<ReadResourceResult> => {
    if (req.params.uri !== CAPABILITIES_URI) {
      // The MCP spec doesn't fully standardize the "resource not
      // found" error shape; some hosts expect an exception, some a
      // contents-empty result. Throw and let the SDK translate to a
      // protocol-level error.
      throw new Error(`Unknown resource: ${req.params.uri}`);
    }
    return buildCapabilitiesResource(sandbox.capabilities) as ReadResourceResult;
  });

  // ── Cancellation notification ────────────────────────────────────
  // MCP clients send `notifications/cancelled` with the original
  // request id when the user cancels. Route that to the matching
  // AbortController so the tool's signal flips.
  server.setNotificationHandler(
    CancelledNotificationSchema,
    async (notification) => {
      const id = notification.params.requestId as string | number;
      const ac = inFlight.get(id);
      if (ac) ac.abort();
    },
  );

  // ── Sandbox lifecycle wiring ─────────────────────────────────────
  // If the sandbox is destroyed externally (e.g. the host tab closes
  // an IndexedDB-backed VFS), tell MCP clients the tool list changed
  // (now empty) and shut down the server. The lifecycle hook here is
  // gap G3 from C-synthesis applied to a real driver.
  sandboxDestroyedListener = sandbox.on("destroyed", () => {
    void (async () => {
      try {
        await server.notification({
          method: "notifications/tools/list_changed",
        });
      } catch {
        /* server may have already closed */
      }
      void stop();
    })();
  });

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    sandboxDestroyedListener?.dispose();
    sandboxDestroyedListener = null;
    for (const ac of inFlight.values()) ac.abort();
    inFlight.clear();
    try {
      await server.close();
    } catch {
      /* swallow — best-effort cleanup */
    }
    sandbox.destroy();
  }

  return {
    server,
    async start(transport: Transport) {
      if (stopped) throw new Error("driver already stopped");
      await server.connect(transport);
    },
    stop,
  };
}
