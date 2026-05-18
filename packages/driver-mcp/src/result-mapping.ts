/**
 * Map a `PieboxResult` into MCP's `CallToolResult` shape.
 *
 * Translation rules:
 *   - `summary` becomes the primary text content. Falls back to
 *     "(ok)" / "(tool failed without summary)" so MCP's
 *     non-empty-content requirement is always satisfied.
 *   - `data` is appended as a fenced JSON block IF it's small enough
 *     to inline (default 4 KB serialized). Larger payloads are
 *     dropped to keep tool responses inside the typical model-context
 *     budget. The threshold is configurable per call site.
 *   - `isError: true` when `ok === false` OR `exitCode !== 0`. The
 *     `exitCode` check is the canonical "failed" idiom from
 *     `PieboxResult`'s docstring — needed because a bash tool can
 *     report `ok: true` while the underlying process exited
 *     non-zero (unusual, but possible in custom tools).
 */

import type { PieboxResult } from "piebox/layer2";

export interface McpContentBlock {
  type: "text";
  text: string;
}

export interface McpToolCallResult {
  content: McpContentBlock[];
  isError?: boolean;
}

export interface MapResultOptions {
  /** Maximum serialized JSON length (bytes) at which `data` is still
   *  inlined as a fenced block. Default 4 KB. */
  inlineDataBudgetBytes?: number;
}

const DEFAULT_INLINE_BUDGET = 4096;

export function mapResultToMcp(
  result: PieboxResult,
  options: MapResultOptions = {},
): McpToolCallResult {
  const budget = options.inlineDataBudgetBytes ?? DEFAULT_INLINE_BUDGET;
  const content: McpContentBlock[] = [];

  if (result.summary) {
    content.push({ type: "text", text: result.summary });
  } else if (result.ok) {
    content.push({ type: "text", text: "(ok)" });
  } else {
    content.push({ type: "text", text: "(tool failed without summary)" });
  }

  if (result.data !== undefined && result.data !== null) {
    let serialized: string | null = null;
    try {
      serialized = JSON.stringify(result.data, null, 2);
    } catch {
      // Non-serializable data (cyclic refs, Uint8Array, etc.) is a tool
      // bug; skip silently. The summary still carries the human signal.
    }
    if (serialized !== null && serialized.length <= budget) {
      content.push({
        type: "text",
        text: "```json\n" + serialized + "\n```",
      });
    }
  }

  const exitNonZero =
    typeof result.exitCode === "number" && result.exitCode !== 0;
  const isError = result.ok === false || exitNonZero;
  return isError ? { content, isError: true } : { content };
}
