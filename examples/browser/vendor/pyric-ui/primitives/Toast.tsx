// Vendored from @pyric/ui/primitives. Headless toast queue + provider.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastInput {
  title: string;
  body?: ReactNode;
  kind?: ToastKind;
  duration?: number;
}

export interface ToastRecord extends ToastInput {
  id: string;
}

interface ToastContextValue {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  toasts: ReadonlyArray<ToastRecord>;
}

const Ctx = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast: missing <ToastProvider> ancestor');
  return ctx;
}

export interface ToastProviderProps {
  children: ReactNode;
  defaultDuration?: number;
  className?: string;
  regionLabel?: string;
}

export function ToastProvider({
  children,
  defaultDuration = 5000,
  className,
  regionLabel = 'Notifications',
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastContextValue['toast']>(
    (input) => {
      const id = crypto.randomUUID();
      const duration = input.duration ?? defaultDuration;
      setToasts((prev) => [...prev, { id, ...input }]);
      if (duration > 0) {
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);
      }
      return id;
    },
    [defaultDuration],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ toast, dismiss, toasts }),
    [toast, dismiss, toasts],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastRegion
        toasts={toasts}
        dismiss={dismiss}
        className={className}
        regionLabel={regionLabel}
      />
    </Ctx.Provider>
  );
}

interface ToastRegionProps {
  toasts: ReadonlyArray<ToastRecord>;
  dismiss: (id: string) => void;
  className?: string;
  regionLabel: string;
}

function ToastRegion({ toasts, dismiss, className, regionLabel }: ToastRegionProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <ol
      aria-label={regionLabel}
      aria-live="polite"
      data-pyric-ui="toast-region"
      className={className}
    >
      {toasts.map((t) => (
        <li
          key={t.id}
          data-pyric-toast
          data-pyric-toast-kind={t.kind ?? 'info'}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          <div data-pyric-toast-title>{t.title}</div>
          {t.body ? <div data-pyric-toast-body>{t.body}</div> : null}
          <button
            type="button"
            data-pyric-toast-dismiss
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </li>
      ))}
    </ol>,
    document.body,
  );
}
