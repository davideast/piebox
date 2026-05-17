// Active Gemini model. piebox only ships the Gemini provider today
// (agent.ts is hard-wired to `@inbrowser/relay`'s gemini path), so the
// picker is a single-select. The shape is intentionally close to
// playground-next's `useLlmStore` so adding a provider switcher later
// is a straight extension — wrap this store with a `providerId` field
// and switch the MODELS const based on it.
//
// Persisted to localStorage so the user's pick survives reload.
import { create } from 'zustand';

export interface ModelDef {
  id: string;
  label: string;
  /** Optional one-liner shown as a `title` tooltip on the option, e.g.
   *  cost / latency hints. */
  hint?: string;
}

// Mirrors the curated list in firebase-agent-sdk/examples/playground-
// next/src/lib/llm/gemini.ts — Gemini 3.x preview lineup. 2.5 slugs are
// intentionally absent because their tool-call thoughtSignature contract
// differs from what `@inbrowser/relay`'s adapter emits.
export const GEMINI_MODELS: readonly ModelDef[] = [
  { id: 'gemini-3.1-flash-lite', label: '3.1 Flash Lite', hint: 'fastest · cheapest' },
  { id: 'gemini-3-flash-preview', label: '3 Flash Preview', hint: 'balanced default' },
  { id: 'gemini-3.1-pro-preview', label: '3.1 Pro Preview', hint: 'slowest · strongest' },
];

const DEFAULT_MODEL_ID = 'gemini-3-flash-preview';
const STORAGE_KEY = 'piebox:model-id';

function readStoredModel(): string {
  if (typeof window === 'undefined') return DEFAULT_MODEL_ID;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v && GEMINI_MODELS.some((m) => m.id === v) ? v : DEFAULT_MODEL_ID;
}

interface ModelState {
  modelId: string;
  setModel(id: string): void;
}

export const useModelStore = create<ModelState>((set) => ({
  modelId: readStoredModel(),
  setModel(id) {
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* localStorage unavailable */
    }
    set({ modelId: id });
  },
}));
