# @piebox/driver-mcp

Model Context Protocol driver for piebox sandboxes.

Exposes a piebox sandbox's `PieboxToolset` over the Model Context Protocol,
so any MCP-compatible host (Claude Desktop, Cursor, etc.) can drive the
sandbox without piebox-specific knowledge. The driver registers each
`PieboxTool` as an MCP tool, the sandbox's `RuntimeCapabilities` as an
MCP resource, and maps `PieboxResult` into MCP's `content[]` / `isError`
shape.

> Part of the composable-sandbox migration. See
> [`docs/investigations/G-migration.md`](../../docs/investigations/G-migration.md)
> Step 6 for the rollout context.

## Status

Pre-1.0 (`private: true`). Not on npm — installed via the piebox
workspace.

## Use

```ts
import { sandbox } from "piebox";
import { createStandardToolset } from "piebox/layer2";
import { createMcpDriver } from "@piebox/driver-mcp";

const sb = sandbox();
const driver = createMcpDriver({
  sandbox: sb.toLayer2Sandbox(),  // (when exposed; spike used a hand-rolled adapter)
  toolset: createStandardToolset(sb.toLayer2Sandbox()),
});

await driver.start();  // defaults to stdio transport
```

## Install in Claude Desktop

Add to `claude_desktop_config.json` (location varies by OS — see Anthropic's
docs):

```json
{
  "mcpServers": {
    "piebox": {
      "command": "node",
      "args": ["/absolute/path/to/piebox/packages/driver-mcp/src/stdio-server.ts"]
    }
  }
}
```

The repo uses TypeScript-as-source for workspace packages today, so the
`args` point at the `.ts` file directly. Once `@piebox/driver-mcp` is
built and published, `args` will point at the `dist/stdio-server.js` (or
the command becomes `npx -y @piebox/driver-mcp`).

The default stdio server constructs a `sandbox()` with `/work` as its
cwd. To customize (different cwd, custom toolset, prior git clone),
write your own entry script that imports `createMcpDriver` directly.

## Capabilities

The driver exposes the sandbox's `RuntimeCapabilities` as an MCP resource
at the URI `piebox://sandbox/capabilities`. Hosts that load resources on
session start can read this once and adapt their UX — for example,
suppressing requests to install native addons when `nativeAddons` is
false.

This separates "what tools exist" (`tools/list`, often re-queried) from
"what the sandbox can do" (capabilities, read once).

## Result mapping

`PieboxResult` → `McpToolCallResult`:

- `summary` → primary `content[0].text`. Falls back to `"(ok)"` /
  `"(tool failed without summary)"` when absent.
- `data` is appended as a fenced JSON block when its serialized length
  is ≤ 4 KB. Larger payloads are dropped to keep tool responses inside
  the typical model-context budget.
- `ok === false` OR `exitCode !== 0` → `isError: true`.

## What's NOT (yet)

- **Streaming.** MCP tools return once. Per [D's investigation](../../docs/investigations/D-streaming.md),
  streaming lives in the driver layer; MCP simply doesn't have a streaming
  primitive for tool responses. The `PieboxTool.executeStreaming` hook
  used by the agent driver and the CLI is not invoked here.
- **Multi-sandbox / session-pool addressing.** One driver instance fronts
  one sandbox. A pool driver lives in a future package.
- **Per-tool annotations** (`readOnlyHint`, `destructiveHint`, etc.).
  Surfaced as a Layer 2 gap in the C.2 spike; pending a Layer 2 update.
- **`outputSchema`.** Same status as annotations.
