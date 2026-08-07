import Link from "next/link";

import type { ReleaseLifecycleState } from "@/lib/release-scenario";
import { cn } from "@/lib/utils";

const SWITCHER_STATES: ReleaseLifecycleState[] = [
  "ELIGIBLE",
  "APPROVAL_PENDING",
  "APPROVED",
  "PREPARED",
  "SUBMITTED",
  "CONFIRMED",
  "RECONCILED",
  "REJECTED",
  "FAILED",
];

const LABEL: Record<ReleaseLifecycleState, string> = {
  DRAFT: "Draft",
  ELIGIBLE: "Eligible",
  APPROVAL_PENDING: "Approval pending",
  APPROVED: "Approved",
  PREPARED: "Prepared",
  SUBMITTED: "Submitted",
  CONFIRMED: "Confirmed",
  RECONCILED: "Reconciled",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

interface LifecycleStateSwitcherProps {
  milestoneId: string;
  current: ReleaseLifecycleState;
}

/**
 * This demonstration has no live adapter to actually advance the release
 * lifecycle, so a state switcher lets a reviewer inspect every required
 * screen state (Issue #14 acceptance criteria) without one existing.
 * Real state changes come only from the deterministic state machine
 * (packages/domain/src/state.ts) once Issues #3/#4/#7 land.
 */
export function LifecycleStateSwitcher({ milestoneId, current }: LifecycleStateSwitcherProps) {
  return (
    <nav aria-label="Preview a release lifecycle state" className="flex flex-wrap gap-2">
      {SWITCHER_STATES.map((state) => {
        const isActive = state === current;
        return (
          <Link
            key={state}
            href={`/app/milestones/${milestoneId}?state=${state}`}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {LABEL[state]}
          </Link>
        );
      })}
    </nav>
  );
}
