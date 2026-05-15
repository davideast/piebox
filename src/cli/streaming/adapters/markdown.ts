import * as fs from "node:fs";
import type { StreamAdapter } from "../adapter.js";
import type { StreamEvent } from "../events.js";

/**
 * Markdown file adapter — writes a detailed, live-updating session log.
 *
 * Every tool call becomes a section with full payloads:
 * - File creates include the complete file content in fenced code blocks
 * - Edits include a unified diff
 * - Bash commands include stdout output
 * - Thinking includes the full reasoning text
 *
 * The file is a valid markdown document at every point during execution.
 */
export class MarkdownAdapter implements StreamAdapter {
  private fd: number | null = null;
  private toolCalls = 0;

  constructor(private filePath: string) {}

  start(): void {
    this.fd = fs.openSync(this.filePath, "w");
  }

  write(event: StreamEvent): void {
    switch (event.type) {
      case "session_start":
        this.append(`# Agent Session\n\n`);
        this.append(`| | |\n|---|---|\n`);
        this.append(`| **Model** | \`${event.model}\` |\n`);
        this.append(`| **Sandbox** | \`${event.sandbox}\` |\n`);
        this.append(`| **Started** | ${new Date(event.timestamp).toISOString()} |\n\n`);
        if (event.prompt) {
          this.append(`> ${event.prompt}\n\n`);
        }
        this.append(`---\n\n`);
        this.append(`## Activity\n\n`);
        break;

      case "thinking":
        this.append(`### 💭 Thinking\n\n`);
        // Indent each line as a blockquote
        const lines = event.text.split("\n").map(l => `> ${l}`).join("\n");
        this.append(`${lines}\n\n`);
        break;

      case "file_create":
        this.toolCalls++;
        this.append(`### ✅ Created \`${event.path}\`\n\n`);
        if (event.content) {
          this.append(`\`\`\`${event.language}\n${event.content}\n\`\`\`\n\n`);
        }
        break;

      case "file_edit":
        this.toolCalls++;
        this.append(`### ✏️ Edited \`${event.path}\`\n\n`);
        if (event.diff) {
          this.append(`\`\`\`diff\n${event.diff}\n\`\`\`\n\n`);
        }
        break;

      case "bash":
        this.toolCalls++;
        this.append(`### 🖥️ \`${event.command}\`\n\n`);
        if (event.output) {
          this.append(`\`\`\`\n${event.output}\n\`\`\`\n\n`);
        }
        break;

      case "file_read":
        this.toolCalls++;
        this.append(`- 📖 Read \`${event.path}\`\n`);
        break;

      case "file_list":
        this.toolCalls++;
        this.append(`- 📂 Listed \`${event.path}\`\n`);
        break;

      case "search":
        this.toolCalls++;
        this.append(`- 🔍 ${event.tool} \`${event.query}\`\n`);
        break;

      case "error":
        this.append(`\n> [!CAUTION]\n> **${event.code}:** ${event.message}\n\n`);
        break;

      case "session_end":
        this.append(`\n---\n\n`);
        this.append(`## Summary\n\n`);
        this.append(`| | |\n|---|---|\n`);
        this.append(`| **Duration** | ${(event.durationMs / 1000).toFixed(1)}s |\n`);
        this.append(`| **Tool calls** | ${this.toolCalls} |\n`);
        this.append(`| **New files** | ${event.newFiles.length} |\n`);
        this.append(`| **Modified files** | ${event.modifiedFiles.length} |\n`);
        this.append(`| **Unchanged** | ${event.unchangedCount} |\n\n`);

        // File tree
        if (event.fileTree && event.fileTree.length > 0) {
          this.append(`## File Tree\n\n`);
          this.append(`| File | Size | Status |\n`);
          this.append(`|---|---|---|\n`);
          for (const f of event.fileTree) {
            const size = f.bytes >= 1024
              ? `${(f.bytes / 1024).toFixed(1)} KB`
              : `${f.bytes} B`;
            const badge = f.status === "new" ? "🆕 new"
              : f.status === "modified" ? "✏️ modified"
              : "—";
            this.append(`| \`${f.path}\` | ${size} | ${badge} |\n`);
          }
          this.append(`\n`);
        }
        break;

      // text_delta: intentionally omitted from session logs
    }
  }

  end(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }

  private append(text: string): void {
    if (this.fd !== null) {
      fs.writeSync(this.fd, text);
    }
  }
}
