import type { StreamEvent } from "./events.js";

/**
 * Adapter interface for the streaming output pipeline.
 *
 * Adapters are sinks — they receive normalized events and render
 * them to a specific format. They never return values and never
 * modify the event stream.
 */
export interface StreamAdapter {
  /** Called once before the first event. */
  start?(): void | Promise<void>;

  /** Called for every normalized event. */
  write(event: StreamEvent): void | Promise<void>;

  /** Called once after the last event. Flush buffers, close handles. */
  end?(): void | Promise<void>;
}

/**
 * Fan-out adapter that forwards events to multiple adapters.
 */
export class MultiAdapter implements StreamAdapter {
  constructor(private adapters: StreamAdapter[]) {}

  async start(): Promise<void> {
    for (const a of this.adapters) {
      await a.start?.();
    }
  }

  async write(event: StreamEvent): Promise<void> {
    for (const a of this.adapters) {
      await a.write(event);
    }
  }

  async end(): Promise<void> {
    for (const a of this.adapters) {
      await a.end?.();
    }
  }
}
