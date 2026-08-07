import Link from "next/link";

import { cn } from "@/lib/utils";

export type ResilienceView = "offline" | "config-missing" | "insufficient-balance";

const SWITCHER_VIEWS: ResilienceView[] = ["offline", "config-missing", "insufficient-balance"];

const LABEL: Record<ResilienceView, string> = {
  offline: "Offline",
  "config-missing": "Configuration missing",
  "insufficient-balance": "Insufficient balance",
};

interface ResilienceStateSwitcherProps {
  milestoneId: string;
  current?: ResilienceView;
}

/**
 * Separate from LifecycleStateSwitcher: these are route-level UI previews
 * for non-happy-path presentation conditions (offline, unconfigured,
 * underfunded), not values of ReleaseLifecycleState — mixing the two
 * switchers would imply these are domain states, which they are not.
 */
export function ResilienceStateSwitcher({ milestoneId, current }: ResilienceStateSwitcherProps) {
  return (
    <nav aria-label="Preview a resilience state" className="flex flex-wrap gap-2">
      {SWITCHER_VIEWS.map((view) => {
        const isActive = view === current;
        return (
          <Link
            key={view}
            href={`/app/milestones/${milestoneId}?view=${view}`}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {LABEL[view]}
          </Link>
        );
      })}
    </nav>
  );
}
