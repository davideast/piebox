// Vendored verbatim from @pyric/ui/agents.
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, body, className }: EmptyStateProps) {
  return (
    <div data-pyric-ui="empty-state" className={className}>
      {icon ? <span data-pyric-empty-icon>{icon}</span> : null}
      <p data-pyric-empty-title>{title}</p>
      {body ? <p data-pyric-empty-body>{body}</p> : null}
    </div>
  );
}
