import type { StreamAdapter } from "../adapter.js";
import type { StreamEvent } from "../events.js";

/**
 * Niftty adapter — renders syntax-highlighted diffs for file mutations.
 *
 * Uses niftty's Shiki-powered renderer to show:
 * - `file_create`: full file with all-green additions, streaming mode
 * - `file_edit`: intra-line change highlighting with collapsed unchanged regions
 *
 * Streaming behavior:
 *   When a file is created, the diff renders with `streaming: true` — niftty
 *   dims lines that haven't been "reached" yet and highlights the current line.
 *   If the same file is edited later in the same session, the adapter clears
 *   the previous render and replaces it with an updated diff showing the
 *   cumulative changes from the original committed version.
 *
 * This adapter handles ONLY file_create and file_edit events.
 * Pair it with TTYAdapter via MultiAdapter for full streaming UX.
 */
export class NifttyAdapter implements StreamAdapter {
  private highlighter: any = null;
  /** Tracks the original content (first seen or committed version) per file. */
  private originalContents = new Map<string, string>();
  /** Tracks the current content (after creates/edits) per file. */
  private currentContents = new Map<string, string>();
  /** Tracks how many lines the last render occupied per file, for ANSI rewind. */
  private lastRenderLines = new Map<string, number>();
  /** The file currently being rendered (for ANSI rewind). */
  private lastRenderedFile: string | null = null;

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
      case "file_create": {
        // Deduplicate: skip if content hasn't changed since last render
        if (this.currentContents.get(event.path) === event.content) break;

        // First time seeing this file — the "original" is empty
        if (!this.originalContents.has(event.path)) {
          this.originalContents.set(event.path, "");
        }
        this.currentContents.set(event.path, event.content);

        await this.renderFileDiff(event.path, {
          streaming: true,
          label: "new",
        });
        break;
      }

      case "file_edit": {
        const original = this.originalContents.get(event.path)
          ?? this.currentContents.get(event.path)
          ?? "";

        // If this is the first time we see this file (edit without prior create),
        // the current content IS the original
        if (!this.originalContents.has(event.path)) {
          this.originalContents.set(event.path, original);
        }

        // Apply edits to get new content
        const current = this.currentContents.get(event.path) ?? "";
        const updated = applyEdits(current, event.diff);
        this.currentContents.set(event.path, updated);

        // If the last render was for this same file, rewind and replace
        const shouldRewind = this.lastRenderedFile === event.path;

        await this.renderFileDiff(event.path, {
          streaming: false,
          label: "modified",
          rewind: shouldRewind,
        });
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
    this.originalContents.clear();
    this.currentContents.clear();
    this.lastRenderLines.clear();
    this.lastRenderedFile = null;
  }

  private async renderFileDiff(
    filePath: string,
    opts: { streaming: boolean; label: string; rewind?: boolean },
  ): Promise<void> {
    const original = this.originalContents.get(filePath) ?? "";
    const current = this.currentContents.get(filePath) ?? "";

    if (original === current) return; // No change

    try {
      const { niftty } = await import("niftty");

      const rendered = await niftty({
        code: current,
        diffWith: original,
        filePath,
        theme: this.theme as any,
        collapseUnchanged: this.collapsed && !opts.streaming,
        lineNumbers: "both",
        streaming: opts.streaming,
        highlighter: this.highlighter ?? undefined,
      });

      // If rewinding, clear the previous render
      if (opts.rewind && this.lastRenderLines.has(filePath)) {
        const linesToClear = this.lastRenderLines.get(filePath)!;
        // Move cursor up and clear each line
        for (let i = 0; i < linesToClear; i++) {
          process.stderr.write("\x1b[A\x1b[2K");
        }
      }

      // Build the framed output
      // Niftty pads lines to maxCols with spaces INSIDE ANSI background color
      // sequences (e.g. \x1b[48;2;R;G;Bm code + padding \x1b[0m). Plain trimEnd()
      // doesn't reach inside the escape codes, so lines overflow on narrow terminals.
      const termWidth = process.stderr.columns || 80;
      const frameLines: string[] = [];
      frameLines.push(`\n  ┌─ ${filePath} (${opts.label})`);
      for (const line of rendered.split("\n")) {
        const stripped = stripAnsiPadding(line);
        if (stripped) frameLines.push(`  │ ${stripped}`);
      }
      const sepWidth = Math.min(termWidth - 4, 58);
      frameLines.push(`  └${"─".repeat(sepWidth)}`);

      const output = frameLines.join("\n") + "\n";
      process.stderr.write(output);

      // Track for potential rewind
      this.lastRenderLines.set(filePath, frameLines.length);
      this.lastRenderedFile = filePath;
    } catch (err) {
      // Log rendering errors for debugging — TTYAdapter handles the fallback display
      process.stderr.write(`  ⚠ niftty render failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

/**
 * Apply edit diffs to original content.
 *
 * The diff from the normalizer uses `- oldLine` / `+ newLine` format.
 * We parse out old/new text blocks and apply sequential replacements.
 */
function applyEdits(original: string, diffString: string): string {
  if (!diffString) return original;

  // Parse the `- old` / `+ new` line format from buildDiff()
  const lines = diffString.split("\n");
  const oldLines: string[] = [];
  const newLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("- ")) {
      oldLines.push(line.slice(2));
    } else if (line.startsWith("+ ")) {
      newLines.push(line.slice(2));
    }
  }

  if (oldLines.length === 0 && newLines.length === 0) {
    return original;
  }

  const oldText = oldLines.join("\n");
  const newText = newLines.join("\n");

  if (oldText && original.includes(oldText)) {
    return original.replace(oldText, newText);
  }

  // If we can't find the old text, append (shouldn't happen in practice)
  return original;
}

/**
 * Strip trailing whitespace padding from niftty ANSI output.
 *
 * Niftty renders each line as:
 *   \x1b[48;2;R;G;Bm  linenum + code + spaces_to_maxCols  \x1b[0m
 *
 * The padding spaces sit INSIDE the background color escape, so plain
 * trimEnd() can't reach them. On narrow terminals the colored padding
 * wraps to the next line, creating double-height rows.
 *
 * Strategy: strip trailing spaces that appear before ANSI reset/color
 * sequences at the end of the line, then re-append just the resets.
 */
function stripAnsiPadding(line: string): string {
  // Fast path: no ANSI escapes at all
  if (!line.includes("\x1b")) return line.trimEnd();

  // Match trailing: spaces followed by ANSI sequences and optional whitespace at EOL
  // The ANSI sequence pattern: \x1b[ followed by digits/semicolons then a letter
  return line.replace(/ +((?:\x1b\[[\d;]*[a-zA-Z])*)\s*$/, "$1");
}
