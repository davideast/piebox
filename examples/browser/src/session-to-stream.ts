/**
 * Translate @pyric/agents' SessionEvent stream into piebox's StreamEvent
 * stream so HTMLStreamAdapter (and any other piebox StreamAdapter) can
 * consume it unchanged.
 *
 * Stateful: tool-name lookup and text-delta accumulation across turns are
 * tracked here. Construct one Translator per session.submit().
 */

import type { SessionEvent } from "@pyric/agents";
import type { StreamEvent } from "piebox/browser";

export class SessionEventTranslator {
  // tool_started gives us name+args+id; tool_finished comes back with just
  // the id, so we remember the name for the tool_result event.
  private toolNameByCallId = new Map<string, string>();

  /**
   * Map one SessionEvent to zero or more StreamEvents. Returns an array so a
   * single `tool_started` for `write` can fan out into both a synthetic
   * `file_create` (for the diff/preview) and a later `tool_result` on
   * `tool_finished`.
   */
  translate(ev: SessionEvent): StreamEvent[] {
    switch (ev.kind) {
      case "text":
        return [{ type: "text_delta", delta: ev.chunk }];

      case "thinking":
        // Each thinking chunk becomes its own card — keeps the UI honest
        // about how the model's reasoning streams in.
        return [{ type: "thinking", text: ev.chunk }];

      case "tool_started": {
        this.toolNameByCallId.set(ev.callId, ev.name);
        const args = (ev.args ?? {}) as Record<string, unknown>;
        switch (ev.name) {
          case "write":
            return [
              {
                type: "file_create",
                path: String(args.path ?? "?"),
                content: typeof args.content === "string" ? args.content : "",
                language: langFromPath(String(args.path ?? "")),
              },
            ];
          case "edit":
            return [
              {
                type: "file_edit",
                path: String(args.path ?? "?"),
                diff: synthDiff(
                  String(args.oldText ?? ""),
                  String(args.newText ?? ""),
                ),
              },
            ];
          case "bash":
            return [
              {
                type: "bash",
                command: String(args.command ?? ""),
                output: "",
                toolCallId: ev.callId,
              },
            ];
          case "read":
            return [
              {
                type: "file_read",
                path: String(args.path ?? ""),
                toolCallId: ev.callId,
              },
            ];
          case "ls":
            return [
              {
                type: "file_list",
                path: String(args.path ?? "."),
                toolCallId: ev.callId,
              },
            ];
          case "grep":
          case "find":
            return [
              {
                type: "search",
                tool: ev.name,
                query: String(args.query ?? args.pattern ?? ""),
                toolCallId: ev.callId,
              },
            ];
          case "git_init":
          case "git_status":
          case "git_add":
          case "git_commit":
          case "git_log":
          case "git_branch":
            // Render git ops as bash-shaped cards so the user sees the
            // operation + its result text. The "command" line is synthesized
            // from the tool name and args for readability.
            return [
              {
                type: "bash",
                command: synthGitCommand(ev.name, args),
                output: "",
                toolCallId: ev.callId,
              },
            ];
          default:
            return [];
        }
      }

      case "tool_finished": {
        const toolName = this.toolNameByCallId.get(ev.callId) ?? "";
        this.toolNameByCallId.delete(ev.callId);
        const result = ev.result;
        // Build a printable string. Bash results carry stdout/stderr in data.
        let output = result.summary ?? "";
        const data = result.data as
          | { stdout?: string; stderr?: string; content?: string; entries?: string[] }
          | undefined;
        if (data?.stdout || data?.stderr) {
          const stream = (data.stdout ?? "") + (data.stderr ?? "");
          output = stream || output;
        } else if (typeof data?.content === "string") {
          // Show file contents back from `read` for transparency in the feed.
          output = data.content.slice(0, 2000);
        } else if (Array.isArray(data?.entries)) {
          output = data.entries.join("\n");
        }
        return [
          {
            type: "tool_result",
            toolCallId: ev.callId,
            toolName,
            output,
            isError: !result.ok,
          },
        ];
      }

      case "error":
        return [
          {
            type: "error",
            code: "AGENT_ERROR",
            message: ev.message,
          } as StreamEvent,
        ];

      // turn_started, turn_completed, workspace_changed, runtime_changed,
      // completed, strategy_event — not surfaced as cards. The host wraps
      // session_start / session_end around the whole submission.
      default:
        return [];
    }
  }
}

const EXT_MAP: Record<string, string> = {
  ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js",
  json: "json", md: "markdown", yaml: "yaml", yml: "yaml",
  html: "html", css: "css", sh: "bash",
};

function langFromPath(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MAP[ext] ?? "text";
}

function synthGitCommand(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "git_init":
      return `git init${args.defaultBranch ? ` (default: ${args.defaultBranch})` : ""}`;
    case "git_status":
      return "git status";
    case "git_add":
      if (args.all) return "git add -A";
      return `git add ${args.filepath ?? "?"}`;
    case "git_commit":
      return `git commit -m "${String(args.message ?? "").slice(0, 80)}"`;
    case "git_log":
      return `git log${args.depth ? ` -n ${args.depth}` : ""}`;
    case "git_branch":
      if (args.current) return "git branch --show-current";
      if (!args.name) return "git branch";
      return `git branch ${args.name}${args.checkout ? " --checkout" : ""}`;
    default:
      return name;
  }
}

function synthDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const lines: string[] = ["@@ edit @@"];
  for (const l of oldLines) lines.push(`-${l}`);
  for (const l of newLines) lines.push(`+${l}`);
  return lines.join("\n");
}
