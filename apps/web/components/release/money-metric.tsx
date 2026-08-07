import type { MoneyAmount } from "@proofspend/domain";

import { formatMoney } from "@/lib/format-money";
import { cn } from "@/lib/utils";

interface MoneyMetricProps {
  label: string;
  amount: MoneyAmount;
  emphasis?: "default" | "large";
  className?: string;
}

/** Every financial value in the app renders through this component so formatting and tabular numerals stay consistent (design.md). */
export function MoneyMetric({ label, amount, emphasis = "default", className }: MoneyMetricProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "money font-semibold text-foreground",
          emphasis === "large" ? "text-2xl md:text-3xl" : "text-lg",
        )}
      >
        {formatMoney(amount)}
      </span>
    </div>
  );
}
