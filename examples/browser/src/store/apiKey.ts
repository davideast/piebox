// Tiny zustand store wrapping localStorage so React can react when the
// API key is set/cleared. agent.ts already has its own getStoredApiKey /
// storeApiKey helpers — this is the React-facing mirror.
import { create } from 'zustand';
import { getStoredApiKey, storeApiKey, clearApiKey } from '../agent.js';

interface ApiKeyState {
  key: string | null;
  set(next: string): void;
  clear(): void;
}

export const useApiKeyStore = create<ApiKeyState>((set) => ({
  key: getStoredApiKey(),
  set(next) {
    storeApiKey(next);
    set({ key: next });
  },
  clear() {
    clearApiKey();
    set({ key: null });
  },
}));
