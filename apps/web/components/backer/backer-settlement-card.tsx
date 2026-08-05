import { CheckCircle2, RefreshCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format-money";
import type { BackerSafeProjectRecord } from "@proofspend/domain";

type BackerSettlement = BackerSafeProjectRecord["settlements"][number];

interface BackerSettlementCardProps {
  settlement: BackerSettlement;
}

/** Screen 7: verified spend summary from the allowlisted backer disclosure projection only. */
export function BackerSettlementCard({ settlement }: BackerSettlementCardProps) {
  const isRefund = settlement.disposition === "REFUND";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Settlement</CardTitle>
        <Badge variant={settlement.state === "RECONCILED" ? "success" : "outline"}>
          {isRefund ? (
            <RefreshCcw aria-hidden="true" className="size-3.5" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="size-3.5" />
          )}
          {settlement.state}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <span className="money text-2xl font-semibold text-foreground">
          {formatMoney(settlement.amount)}
        </span>
        <span className="text-sm text-muted-foreground">
          {isRefund ? "Refunded to founder" : "Settled to recipient"} ·{" "}
          {new Date(settlement.updatedAt).toLocaleDateString()}
        </span>
      </CardContent>
    </Card>
  );
}
