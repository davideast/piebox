// API key modal. piebox's agent uses Gemini direct-from-browser; the key
// is stored under localStorage key `piebox-playground:google-api-key`
// (see agent.ts). Uses the vendored @pyric/ui/agents Modal for behavior.
import { useState } from 'react';
import { Modal } from '@pyric/ui/agents';
import { useApiKeyStore } from '../store/apiKey.js';
import { ModelPicker } from './ModelPicker.js';

interface ApiKeyModalProps {
  open: boolean;
  onClose: () => void;
}

export function ApiKeyModal({ open, onClose }: ApiKeyModalProps) {
  const currentKey = useApiKeyStore((s) => s.key);
  const setKey = useApiKeyStore((s) => s.set);
  const clearKey = useApiKeyStore((s) => s.clear);
  const [value, setValue] = useState('');

  const onSave = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setKey(trimmed);
    setValue('');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} ariaLabel="API key">
      {/* Picker shown inside the modal on mobile (where the TopBar is
          tight and `<ModelPicker />` is hidden up there). Desktop
          shows the picker in the TopBar; this block is hidden there
          to avoid duplication. */}
      <div className="md:hidden mb-4">
        <p className="text-[11px] uppercase tracking-wider text-slate-gray mb-2">
          Active model
        </p>
        <ModelPicker />
      </div>
      <h2 className="text-[13px] font-medium text-soft-white mb-1">Gemini API key</h2>
      <p className="text-[11px] text-slate-gray mb-4">
        Bring your own key. Stored in this browser only — never sent to a server we control.
      </p>
      <label className="block">
        <span className="block text-[11px] uppercase tracking-wider text-slate-gray mb-1">
          API key
        </span>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={currentKey ? '••••••••••••  (type to replace)' : 'Paste your Gemini API key'}
          className="w-full bg-content-bg border border-[#2a2a35] rounded-md px-3 py-2 text-[13px] text-soft-white placeholder:text-slate-gray/60 focus:outline-none focus:border-slate-gray transition-colors font-mono"
        />
      </label>
      <p className="text-[10px] text-slate-gray mt-2">
        Get one at <span className="font-mono">aistudio.google.com/apikey</span>.
      </p>

      <div className="mt-5 flex items-center justify-between">
        {currentKey ? (
          <button
            type="button"
            onClick={() => {
              clearKey();
              setValue('');
            }}
            className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
          >
            Clear stored key
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-full text-[12px] text-slate-gray hover:text-soft-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!value.trim()}
            className={[
              'px-4 py-1.5 rounded-full text-[12px] font-semibold transition-colors',
              value.trim()
                ? 'bg-soft-white text-content-bg hover:bg-white'
                : 'bg-soft-white/20 text-soft-white/40 cursor-not-allowed',
            ].join(' ')}
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
