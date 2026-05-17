// Compact model picker rendered in the TopBar. Single `<select>` for now
// because piebox only ships the Gemini provider; if a second provider
// lands, this becomes two selects (provider on the left, model on the
// right) — same shape as playground-next's ModelPicker.
//
// Pure presentational: reads + writes useModelStore.
import { GEMINI_MODELS, useModelStore } from '../store/model.js';

export function ModelPicker() {
  const modelId = useModelStore((s) => s.modelId);
  const setModel = useModelStore((s) => s.setModel);

  return (
    <select
      value={modelId}
      onChange={(e) => setModel(e.target.value)}
      title="Gemini model"
      className={[
        'h-7 px-2 rounded-md bg-[#2a2a35] text-soft-white text-[12px] font-mono max-w-[180px]',
        'border border-[#3a3a45] hover:border-[#4a4a55] transition-colors',
        'focus:outline-none focus:border-soft-white/40',
      ].join(' ')}
    >
      {GEMINI_MODELS.map((m) => (
        <option key={m.id} value={m.id} title={m.hint ?? ''}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
