/**
 * Browser-safe streaming entry.
 *
 * Re-exports only the pure pieces of the streaming pipeline — the event
 * model, normalizer, and the StreamAdapter interface + fan-out. The
 * concrete TTY/Markdown/Niftty adapters live under ./cli/streaming and
 * are Node-only (they depend on process.stdout, node:fs/promises, niftty).
 *
 * Consumers write their own adapter for the target environment (browser,
 * webview, etc.) by implementing StreamAdapter.
 */

export type { StreamEvent, FileEntry } from "./cli/streaming/events.js";
export { NormalizerState } from "./cli/streaming/events.js";
export { normalize } from "./cli/streaming/normalize.js";
export type { StreamAdapter } from "./cli/streaming/adapter.js";
export { MultiAdapter } from "./cli/streaming/adapter.js";
