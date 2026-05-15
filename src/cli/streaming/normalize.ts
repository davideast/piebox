import type { StreamEvent } from "./events.js";
import { NormalizerState } from "./events.js";

/**
 * Convert a raw SDK event into a normalized StreamEvent.
 *
 * This is the ONLY function that knows about the raw event shape
 * (event.assistantMessageEvent.toolCall.arguments). Everything
 * downstream works with typed StreamEvent objects.
 *
 * Returns null for events that should be silently skipped.
 */
export function normalize(raw: any, state: NormalizerState): StreamEvent | null {
  if (raw.type !== "message_update") return null;
  const inner = raw.assistantMessageEvent;
  if (!inner) return null;

  // ── Thinking ────────────────────────────────────────────────────
  if (inner.type === "thinking_delta") {
    state.appendThinking(inner.delta ?? "");
    return null;
  }

  if (inner.type === "thinking_end") {
    const text = state.flushThinking();
    return text ? { type: "thinking", text } : null;
  }

  // ── Tool calls ──────────────────────────────────────────────────
  if (inner.type === "toolcall_end") {
    const tc = inner.toolCall ?? {};
    const name: string = tc.name ?? "";
    const args = tc.arguments ?? {};

    switch (name) {
      case "write":
        return { type: "file_create", path: args.path ?? "?" };
      case "edit":
        return { type: "file_edit", path: args.path ?? "?" };
      case "bash":
        return { type: "bash", command: typeof args.command === "string" ? args.command : "" };
      case "read":
        return { type: "file_read", path: args.path ?? "" };
      case "ls":
        return { type: "file_list", path: args.path ?? "." };
      case "grep":
        return { type: "search", tool: "grep", query: args.query ?? args.pattern ?? "" };
      case "find":
        return { type: "search", tool: "find", query: args.pattern ?? "" };
      default:
        return null;
    }
  }

  // ── Text output ─────────────────────────────────────────────────
  if (inner.type === "text_delta") {
    return { type: "text_delta", delta: inner.delta ?? "" };
  }

  return null;
}
