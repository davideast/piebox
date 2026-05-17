// Vendored verbatim from @pyric/ui/agents.
import { useEffect, type ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
  backdropClassName?: string;
  panelClassName?: string;
}

export function Modal({
  open,
  onClose,
  children,
  ariaLabel,
  className,
  backdropClassName,
  panelClassName,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      data-pyric-ui="modal"
      className={className}
    >
      <div
        data-pyric-modal-backdrop
        className={backdropClassName}
        onClick={onClose}
        aria-hidden="true"
      />
      <div data-pyric-modal-panel className={panelClassName}>
        {children}
      </div>
    </div>
  );
}
