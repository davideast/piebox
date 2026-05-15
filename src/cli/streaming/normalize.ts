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
  // ── Tool execution results (top-level events, not inside assistantMessageEvent) ──
  if (raw.type === "tool_execution_end") {
    const content = raw.result?.content;
    const text = Array.isArray(content) && content.length > 0
      ? content.map((c: any) => c.text ?? "").join("\n")
      : "";
    return {
      type: "tool_result",
      toolCallId: raw.toolCallId ?? "",
      toolName: raw.toolName ?? "",
      output: text,
      isError: raw.isError ?? false,
    };
  }

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
    const id: string = tc.id ?? tc.toolCallId ?? "";

    switch (name) {
      case "write":
        return {
          type: "file_create",
          path: args.path ?? "?",
          content: typeof args.content === "string" ? args.content : "",
          language: langFromPath(args.path ?? ""),
        };
      case "edit":
        return {
          type: "file_edit",
          path: args.path ?? "?",
          diff: buildDiff(args),
        };
      case "bash":
        return {
          type: "bash",
          command: typeof args.command === "string" ? args.command : "",
          output: "",  // populated later via tool_result
          toolCallId: id,
        };
      case "read":
        return { type: "file_read", path: args.path ?? "", toolCallId: id };
      case "ls":
        return { type: "file_list", path: args.path ?? ".", toolCallId: id };
      case "grep":
        return { type: "search", tool: "grep", query: args.query ?? args.pattern ?? "", toolCallId: id };
      case "find":
        return { type: "search", tool: "find", query: args.pattern ?? "", toolCallId: id };
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

// ── Helpers ─────────────────────────────────────────────────────────────────

const EXT_MAP: Record<string, string> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx",
  py: "python", rs: "rust", go: "go", rb: "ruby",
  json: "json", md: "markdown", yaml: "yaml", yml: "yaml",
  sh: "bash", bash: "bash", zsh: "bash",
  html: "html", css: "css", sql: "sql", xml: "xml",
  toml: "toml", ini: "ini", cfg: "ini",
  dockerfile: "dockerfile",
};

/** Infer fenced code block language from file extension. */
export function langFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MAP[ext] ?? "";
}

/** Build a unified-style diff from edit tool arguments. */
function buildDiff(args: Record<string, any>): string {
  const oldStr = typeof args.old_string === "string" ? args.old_string : "";
  const newStr = typeof args.new_string === "string" ? args.new_string : "";
  if (!oldStr && !newStr) return "";

  const oldLines = oldStr.split("\n").map((l: string) => `- ${l}`);
  const newLines = newStr.split("\n").map((l: string) => `+ ${l}`);
  return [...oldLines, ...newLines].join("\n");
}
