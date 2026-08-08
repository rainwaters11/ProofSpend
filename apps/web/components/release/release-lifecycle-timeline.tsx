import { AlertOctagon, Check, ShieldX } from "lucide-react";

import type { ReleaseLifecycleState } from "@/lib/release-scenario";
import { cn } from "@/lib/utils";

const HAPPY_PATH: ReleaseLifecycleState[] = [
  "ELIGIBLE",
  "APPROVAL_PENDING",
  "APPROVED",
  "PREPARED",
  "SUBMITTED",
  "CONFIRMED",
  "RECONCILED",
];

const STEP_LABEL: Record<ReleaseLifecycleState, string> = {
  DRAFT: "Draft",
  ELIGIBLE: "Eligible",
  APPROVAL_PENDING: "Approval",
  APPROVED: "Approved",
  PREPARED: "Prepared",
  SUBMITTED: "Submitted",
  CONFIRMED: "Confirmed",
  RECONCILED: "Reconciled",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

interface ReleaseLifecycleTimelineProps {
  current: ReleaseLifecycleState;
}

/**
 * Visual stepper for the release lifecycle. Rejected/Failed render as a
 * distinct terminal branch rather than a step on the happy path, so a
 * failure can never be read as "further along" a linear progress bar
 * (design.md motion rules: no implying money moved before confirmation).
 *
 * Rejected and failed are kept visually and semantically separate: a
 * rejection is a human decision made at the approval gate (the release
 * never had a prepared/submitted transaction), while a failure means a
 * transaction was attempted and did not confirm. Conflating the two would
 * misrepresent how far the release actually got.
 */
export function ReleaseLifecycleTimeline({ current }: ReleaseLifecycleTimelineProps) {
  const isRejected = current === "REJECTED";
  const isFailed = current === "FAILED";
  const isTerminalFailure = isRejected || isFailed;
  const anchorStep = isRejected ? "APPROVAL_PENDING" : isFailed ? "APPROVED" : current;
  const currentIndex = HAPPY_PATH.indexOf(anchorStep);
  const FailureIcon = isRejected ? ShieldX : AlertOctagon;

  return (
    <div className="w-full">
      <ol
        className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-0"
        aria-label="Release lifecycle progress"
      >
        {HAPPY_PATH.map((step, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = !isTerminalFailure && index === currentIndex;
          const isHalted = isTerminalFailure && index === currentIndex;
          const isUpcoming = index > currentIndex;

          return (
            <li key={step} className="flex flex-1 items-start gap-2 sm:flex-col sm:items-center sm:gap-2">
              <div className="flex items-center sm:w-full">
                {index > 0 && (
                  <div
                    className={cn(
                      "hidden h-px flex-1 sm:block",
                      isComplete || isCurrent || isHalted ? "bg-primary" : "bg-border",
                    )}
                    aria-hidden="true"
                  />
                )}
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold",
                    isComplete && "border-primary bg-primary text-primary-foreground",
                    isCurrent && "border-primary bg-background text-primary",
                    isHalted && "border-destructive bg-destructive/10 text-destructive",
                    isUpcoming && "border-border bg-background text-muted-foreground",
                  )}
                  aria-current={isCurrent || isHalted ? "step" : undefined}
                >
                  {isComplete && <Check aria-hidden="true" className="size-4" />}
                  {isHalted && <FailureIcon aria-hidden="true" className="size-4" />}
                  {!isComplete && !isHalted && index + 1}
                </span>
                {index < HAPPY_PATH.length - 1 && (
                  <div
                    className={cn(
                      "hidden h-px flex-1 sm:block",
                      isComplete ? "bg-primary" : "bg-border",
                    )}
                    aria-hidden="true"
                  />
                )}
              </div>
              <span
                className={cn(
                  "text-xs font-medium sm:text-center",
                  isCurrent || isHalted ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {STEP_LABEL[step]}
              </span>
            </li>
          );
        })}
      </ol>

      {isRejected && (
        <div
          className="mt-4 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
          role="status"
        >
          <ShieldX aria-hidden="true" className="size-4 shrink-0" />
          Lifecycle ended at founder approval: Rejected
        </div>
      )}

      {isFailed && (
        <div
          className="mt-4 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
          role="status"
        >
          <AlertOctagon aria-hidden="true" className="size-4 shrink-0" />
          Lifecycle ended: Failed
        </div>
      )}
    </div>
  );
}
