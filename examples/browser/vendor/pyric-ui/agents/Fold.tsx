// Vendored verbatim from @pyric/ui/agents (firebase-agent-sdk). Headless
// disclosure container — see Fold's JSDoc for the [data-pyric-*] hooks.
import type { ReactNode } from 'react';

export type FoldTone = 'normal' | 'error' | 'thought';

export interface FoldProps {
  header: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  tone?: FoldTone;
  className?: string;
  summaryClassName?: string;
  bodyClassName?: string;
}

export function Fold({
  header,
  headerAction,
  children,
  defaultOpen = false,
  tone = 'normal',
  className,
  summaryClassName,
  bodyClassName,
}: FoldProps) {
  return (
    <details
      data-pyric-ui="fold"
      data-pyric-fold-tone={tone}
      open={defaultOpen}
      className={className}
    >
      <summary data-pyric-fold-summary className={summaryClassName}>
        <span data-pyric-fold-chevron aria-hidden="true" />
        <span data-pyric-fold-header>{header}</span>
        {headerAction ? <span data-pyric-fold-action>{headerAction}</span> : null}
      </summary>
      <div data-pyric-fold-body className={bodyClassName}>{children}</div>
    </details>
  );
}
