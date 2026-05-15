// Streaming output pipeline
export type { StreamEvent, FileEntry } from "./events.js";
export { NormalizerState } from "./events.js";
export { normalize } from "./normalize.js";
export type { StreamAdapter } from "./adapter.js";
export { MultiAdapter } from "./adapter.js";
export { TTYAdapter } from "./adapters/tty.js";
export { MarkdownAdapter } from "./adapters/markdown.js";
