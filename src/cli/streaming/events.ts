/**
 * Normalized event model for the streaming output pipeline.
 *
 * This is the contract between the normalizer (which understands raw SDK events)
 * and adapters (which render to specific formats). Adapters never touch raw events.
 */

// ── Stream Events ───────────────────────────────────────────────────────────

export type StreamEvent =
  | SessionStartEvent
  | ThinkingEvent
  | FileCreateEvent
  | FileEditEvent
  | BashEvent
  | FileReadEvent
  | FileListEvent
  | SearchEvent
  | ToolResultEvent
  | TextDeltaEvent
  | SessionEndEvent
  | ErrorEvent;

export interface SessionStartEvent {
  type: "session_start";
  model: string;
  sandbox: string;
  prompt: string;
  timestamp: number;
}

export interface ThinkingEvent {
  type: "thinking";
  text: string;
}

export interface FileCreateEvent {
  type: "file_create";
  path: string;
  content: string;
  language: string;
}

export interface FileEditEvent {
  type: "file_edit";
  path: string;
  diff: string;
}

export interface BashEvent {
  type: "bash";
  command: string;
  output: string;
  toolCallId: string;
}

export interface FileReadEvent {
  type: "file_read";
  path: string;
  toolCallId: string;
}

export interface FileListEvent {
  type: "file_list";
  path: string;
  toolCallId: string;
}

export interface SearchEvent {
  type: "search";
  tool: "grep" | "find";
  query: string;
  toolCallId: string;
}

export interface ToolResultEvent {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  output: string;
  isError: boolean;
}

export interface TextDeltaEvent {
  type: "text_delta";
  delta: string;
}

export interface FileEntry {
  path: string;
  bytes: number;
  status: "new" | "modified" | "unchanged";
}

export interface SessionEndEvent {
  type: "session_end";
  durationMs: number;
  newFiles: string[];
  modifiedFiles: string[];
  unchangedCount: number;
  toolCalls: number;
  fileTree: FileEntry[];
}

export interface ErrorEvent {
  type: "error";
  code: string;
  message: string;
}

// ── Normalizer State ────────────────────────────────────────────────────────

/**
 * Accumulates thinking deltas across multiple `thinking_delta` events,
 * then flushes a cleaned summary on `thinking_end`.
 */
export class NormalizerState {
  private thinkingBuffer = "";

  appendThinking(delta: string): void {
    this.thinkingBuffer += delta;
  }

  flushThinking(): string | null {
    if (this.thinkingBuffer.length === 0) return null;
    const cleaned = this.thinkingBuffer
      .replace(/\*\*/g, "")
      .trim();
    this.thinkingBuffer = "";
    return cleaned || null;
  }
}
