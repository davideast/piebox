// Vendored verbatim from @pyric/ui/agents.
export interface PulsingDotProps {
  className?: string;
}

export function PulsingDot({ className }: PulsingDotProps) {
  return (
    <span data-pyric-ui="pulsing-dot" className={className}>
      <span data-pyric-pulse-ring aria-hidden="true" />
      <span data-pyric-pulse-core aria-hidden="true" />
    </span>
  );
}
