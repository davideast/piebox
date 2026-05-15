import type { StreamAdapter } from "../adapter.js";
import type { StreamEvent } from "../events.js";

/**
 * Niftty adapter — renders syntax-highlighted diffs for file mutations.
 *
 * Uses niftty's Shiki-powered renderer to show:
 * - `file_create`: full file with all-green additions
 * - `file_edit`: intra-line change highlighting with collapsed unchanged regions
 *
 * This adapter handles ONLY file_create and file_edit events.
 * Pair it with TTYAdapter via MultiAdapter for full streaming UX.
 */
export class NifttyAdapter implements StreamAdapter {
  private highlighter: any = null;
  private fileContents = new Map<string, string>();

  /**
   * @param collapsed - Whether to collapse unchanged regions (default: true)
   * @param theme - Shiki theme name (default: "github-dark")
   */
  constructor(
    private collapsed = true,
    private theme: string = "github-dark",
  ) {}

  async start(): Promise<void> {
    // Pre-create a shared highlighter to avoid cold-start on first file event
    try {
      const shiki = await import("shiki");
      this.highlighter = await shiki.createHighlighter({
        themes: [this.theme],
        langs: ["typescript", "javascript", "json", "markdown", "html", "css", "yaml", "tsx", "jsx"],
      });
    } catch {
      // Fall back to per-call highlighter creation
      this.highlighter = null;
    }
  }

  async write(event: StreamEvent): Promise<void> {
    switch (event.type) {
      case "file_create":
        // Track content for future edits
        this.fileContents.set(event.path, event.content);
        await this.renderDiff("", event.content, event.path, true);
        break;

      case "file_edit": {
        // Get the original content (before this edit)
        const original = this.fileContents.get(event.path) ?? "";
        // Apply the edit to get new content
        // The diff string from the event is a patch, but we need the final content.
        // For now we reconstruct from the edit details. The file_edit event
        // contains the diff string (old/new text pairs), so we apply them.
        const updated = applyEdits(original, event.diff);
        this.fileContents.set(event.path, updated);
        await this.renderDiff(original, updated, event.path, false);
        break;
      }

      // All other events: pass through silently
    }
  }

  async end(): Promise<void> {
    if (this.highlighter) {
      this.highlighter.dispose();
      this.highlighter = null;
    }
    this.fileContents.clear();
  }

  private async renderDiff(
    original: string,
    current: string,
    filePath: string,
    isNew: boolean,
  ): Promise<void> {
    try {
      const { niftty } = await import("niftty");

      const rendered = await niftty({
        code: current,
        diffWith: original,
        filePath,
        theme: this.theme as any,
        collapseUnchanged: this.collapsed,
        lineNumbers: "both",
        highlighter: this.highlighter ?? undefined,
      });

      // File header
      const label = isNew ? "(new)" : "(modified)";
      process.stderr.write(`\n  ┌─ ${filePath} ${label}\n`);
      // Indent each line of rendered output
      const lines = rendered.split("\n");
      for (const line of lines) {
        process.stderr.write(`  │ ${line}\n`);
      }
      process.stderr.write(`  └${"─".repeat(58)}\n`);
    } catch {
      // Fallback: just print the path (TTYAdapter already does this)
    }
  }
}

/**
 * Apply edit diffs to original content.
 *
 * The edit diff format from the normalizer is a series of
 * `oldText → newText` replacements as a stringified patch.
 * For simple cases, we do sequential string replacement.
 */
function applyEdits(original: string, diffString: string): string {
  // The diff string from FileEditEvent contains the edit tool's output.
  // Format: pairs of oldText/newText. We parse and apply sequentially.
  //
  // If the diff format is a unified diff, we can't easily apply it.
  // For now, return original + diff appended as a fallback indicator
  // that the TTYAdapter should handle the raw diff display.
  //
  // The real content will be tracked via file_create events for new
  // writes and subsequent reads. This is a best-effort reconstruction.
  try {
    // Try to parse as JSON edit pairs: [{ oldText, newText }]
    const edits = JSON.parse(diffString) as Array<{ oldText: string; newText: string }>;
    let result = original;
    for (const edit of edits) {
      result = result.replace(edit.oldText, edit.newText);
    }
    return result;
  } catch {
    // Not JSON — treat as a unified diff or raw patch.
    // Return original since we can't reliably apply it.
    return original;
  }
}
