import * as fs from "node:fs";
import type { StreamAdapter } from "../adapter.js";
import type { StreamEvent } from "../events.js";

/**
 * Markdown file adapter — writes a live-updating .md file during agent execution.
 *
 * The file is a complete, readable markdown document at every point during
 * execution. It accumulates an activity log and writes a summary at the end.
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
        this.append(`| **Model** | ${event.model} |\n`);
        this.append(`| **Sandbox** | ${event.sandbox} |\n`);
        this.append(`| **Started** | ${new Date(event.timestamp).toISOString()} |\n\n`);
        this.append(`## Activity\n\n`);
        break;

      case "file_create":
        this.toolCalls++;
        this.append(`- ✅ Created \`${event.path}\`\n`);
        break;

      case "file_edit":
        this.toolCalls++;
        this.append(`- ✏️ Edited \`${event.path}\`\n`);
        break;

      case "bash":
        this.toolCalls++;
        this.append(`- 🖥️ \`${event.command}\`\n`);
        break;

      case "thinking":
        this.append(`- 💭 ${event.text}\n`);
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
        this.append(`\n> ❌ **${event.code}:** ${event.message}\n\n`);
        break;

      case "session_end":
        this.append(`\n## Summary\n\n`);
        this.append(`| | |\n|---|---|\n`);
        this.append(`| **Duration** | ${(event.durationMs / 1000).toFixed(1)}s |\n`);
        this.append(`| **Tool calls** | ${this.toolCalls} |\n`);
        this.append(`| **New files** | ${event.newFiles.length} |\n`);
        this.append(`| **Modified files** | ${event.modifiedFiles.length} |\n`);
        this.append(`| **Unchanged** | ${event.unchangedCount} |\n\n`);

        if (event.newFiles.length > 0) {
          this.append(`### New files\n\n`);
          for (const f of event.newFiles) this.append(`- \`${f}\`\n`);
          this.append(`\n`);
        }
        if (event.modifiedFiles.length > 0) {
          this.append(`### Modified files\n\n`);
          for (const f of event.modifiedFiles) this.append(`- \`${f}\`\n`);
          this.append(`\n`);
        }
        break;

      // text_delta: skip in markdown (agent prose not useful in session log)
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
