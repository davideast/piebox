/**
 * Tracer wiring for the playground.
 *
 * `@pyric/agents` exposes a `Tracer { emit(event) }` interface that the
 * ReAct strategy calls once per ReAct iteration, BEFORE each LLM dispatch.
 * The event carries an `LlmRequestTrace` — the exact wire snapshot the
 * model is about to see (systemPrompt + messages + tools + llm id).
 *
 * We implement two things here:
 *   • `createUiTracer(sink)` — the Tracer impl; pure adapter, no UI deps
 *   • `TracePanel` — the DOM sink; one collapsible per turn, one request
 *     row per ReAct iteration, with the system prompt, messages-as-sent,
 *     and tool declarations expanded inline
 *
 * Tracer.emit() must be synchronous and non-throwing (per the @pyric/agents
 * contract). We wrap every sink call in try/catch and log errors to the
 * console — a misbehaving sink must never delay or fail an LLM dispatch.
 */

import type {
  LlmRequestTrace,
  LlmResponseTrace,
  Tracer,
  TraceEvent,
} from "@pyric/agents";

export interface TraceSink {
  appendRequest(req: LlmRequestTrace): void;
  appendResponse?(res: LlmResponseTrace): void;
}

export function createUiTracer(sink: TraceSink): Tracer {
  return {
    emit(event: TraceEvent): void {
      try {
        if (event.kind === "llm_request") {
          sink.appendRequest(event.data);
        } else if (event.kind === "llm_response" && sink.appendResponse) {
          sink.appendResponse(event.data);
        }
      } catch (e) {
        console.error("[tracer] sink error:", e);
      }
    },
  };
}

// ── DOM sink ──────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<{ className: string; textContent: string; innerHTML: string }> = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.textContent !== undefined) node.textContent = props.textContent;
  if (props.innerHTML !== undefined) node.innerHTML = props.innerHTML;
  return node;
}

function pretty(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export class TracePanel implements TraceSink {
  private container: HTMLElement;
  // One <details> per turnId; new requests for the same turn append into it.
  private detailsByTurn = new Map<string, HTMLDetailsElement>();
  private requestCountByTurn = new Map<string, number>();

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /** Reset the panel (called when the user clicks Clear feed). */
  clear(): void {
    this.detailsByTurn.clear();
    this.requestCountByTurn.clear();
    this.container.textContent = "";
  }

  appendRequest(req: LlmRequestTrace): void {
    let det = this.detailsByTurn.get(req.turnId);
    if (!det) {
      det = this.makeTurnDetails(req.turnId);
      this.container.appendChild(det);
      this.detailsByTurn.set(req.turnId, det);
    }

    const count = (this.requestCountByTurn.get(req.turnId) ?? 0) + 1;
    this.requestCountByTurn.set(req.turnId, count);
    this.refreshTurnSummary(det, req.turnId, count);

    det.appendChild(this.renderRequest(req));
  }

  private makeTurnDetails(turnId: string): HTMLDetailsElement {
    const det = el("details", { className: "tr-turn" });
    det.open = false;
    const summary = el("summary", { className: "tr-summary" });
    summary.dataset.turnId = turnId;
    summary.textContent = `▸ ${turnId} · 0 requests`;
    det.appendChild(summary);
    return det;
  }

  private refreshTurnSummary(
    det: HTMLDetailsElement,
    turnId: string,
    count: number,
  ): void {
    const summary = det.querySelector("summary");
    if (summary) summary.textContent = `${turnId} · ${count} request${count === 1 ? "" : "s"}`;
  }

  private renderRequest(req: LlmRequestTrace): HTMLElement {
    const card = el("div", { className: "tr-request" });
    const head = el("div", { className: "tr-request-head" });
    head.textContent = `iteration ${req.iteration} · ${req.llm.id} · ${req.messages.length} message${req.messages.length === 1 ? "" : "s"} · ${req.tools.length} tool${req.tools.length === 1 ? "" : "s"}`;
    card.appendChild(head);

    card.appendChild(this.section("system prompt", req.systemPrompt));
    card.appendChild(this.section(`messages (${req.messages.length})`, pretty(req.messages)));
    card.appendChild(
      this.section(
        `tools (${req.tools.length})`,
        pretty(req.tools.map((t) => ({ name: t.name, description: t.description }))),
      ),
    );
    return card;
  }

  private section(label: string, body: string): HTMLElement {
    const sect = el("details", { className: "tr-section" });
    sect.appendChild(el("summary", { textContent: label }));
    const pre = el("pre", { className: "tr-body", textContent: body });
    sect.appendChild(pre);
    return sect;
  }
}
