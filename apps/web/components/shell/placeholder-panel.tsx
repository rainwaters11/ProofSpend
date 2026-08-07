import type { ReactNode } from "react";

interface PlaceholderPanelProps {
  title: string;
  phase: "Phase B" | "Phase C" | "Phase D";
  children?: ReactNode;
}

/**
 * Every Issue #14 Phase A route renders through this panel so no page
 * invents product copy, balances, or protocol state ahead of its owning
 * phase (docs/roadmap.md, AGENTS.md truthfulness boundaries).
 */
export function PlaceholderPanel({ title, phase, children }: PlaceholderPanelProps) {
  return (
    <section aria-labelledby="placeholder-title" className="max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Placeholder route — {phase}
      </p>
      <h1 id="placeholder-title" className="mt-2 text-2xl font-semibold text-foreground">
        {title}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        This screen has no live data yet. The composition for this route ships in {phase} once its
        corresponding domain contract is available (see docs/roadmap.md and docs/dependency-map.md).
        Nothing shown here is a real balance, transaction, or protocol state.
      </p>
      {children}
    </section>
  );
}
