import type { StreamAdapter } from "../adapter.js";
import type { StreamEvent } from "../events.js";

/**
 * TTY adapter — renders streaming events to the terminal (stderr).
 *
 * Default mode: only file mutations (create/edit).
 * Verbose mode: also shows bash commands, thinking, listings.
 */
export class TTYAdapter implements StreamAdapter {
  private consecutiveBash = 0;
  private readonly MAX_BASH = 5;

  constructor(private verbose: boolean) {}

  write(event: StreamEvent): void {
    switch (event.type) {
      case "session_start":
        this.log(`\n🤖 Prompting ${event.model}...`);
        break;

      case "file_create":
        this.flushBashOverflow();
        this.log(`  + ${event.path}`);
        break;

      case "file_edit":
        this.flushBashOverflow();
        this.log(`  ~ ${event.path}`);
        break;

      case "bash":
        if (!this.verbose) return;
        this.consecutiveBash++;
        if (this.consecutiveBash <= this.MAX_BASH) {
          const cmd = event.command.length > 60
            ? event.command.slice(0, 57) + "..."
            : event.command;
          this.log(`  $ ${cmd}`);
        }
        return; // don't reset consecutiveBash

      case "thinking":
        if (!this.verbose) return;
        this.flushBashOverflow();
        this.log(`  💭 ${event.text}`);
        break;

      case "file_list":
        if (!this.verbose) return;
        this.flushBashOverflow();
        this.log(`  📂 ${event.path}`);
        break;

      case "search":
        if (!this.verbose) return;
        this.flushBashOverflow();
        this.log(`  🔍 ${event.tool} ${event.query}`);
        break;

      case "session_end":
        this.flushBashOverflow();
        this.log(`\n${"─".repeat(40)}`);
        this.log(`✓ ${(event.durationMs / 1000).toFixed(1)}s · ${event.newFiles.length} new · ${event.modifiedFiles.length} modified · ${event.toolCalls} tool calls\n`);
        if (event.newFiles.length > 0) {
          for (const f of event.newFiles) this.log(`  + ${f}`);
        }
        if (event.modifiedFiles.length > 0) {
          for (const f of event.modifiedFiles) this.log(`  ~ ${f}`);
        }
        break;

      case "text_delta":
        if (this.verbose) process.stdout.write(event.delta);
        break;

      case "error":
        this.log(`\n❌ ${event.code}: ${event.message}`);
        break;

      // file_read: intentionally silent
    }
  }

  private flushBashOverflow(): void {
    if (this.consecutiveBash > this.MAX_BASH) {
      this.log(`  ... (${this.consecutiveBash - this.MAX_BASH} more)`);
    }
    this.consecutiveBash = 0;
  }

  private log(msg: string): void {
    process.stderr.write(msg + "\n");
  }
}
