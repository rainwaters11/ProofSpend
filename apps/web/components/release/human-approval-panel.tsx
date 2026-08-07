import { ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";

import type { ApprovalRecord, ReleaseRequest } from "@proofspend/domain";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { MoneyMetric } from "@/components/release/money-metric";

interface HumanApprovalPanelProps {
  release: ReleaseRequest;
  approval: ApprovalRecord | null;
  destination: string;
  network: string;
  interactive?: boolean;
}

/**
 * Requirement: the human approval screen must show the exact USDC amount,
 * destination, and Arc Testnet network — nothing summarized or rounded.
 * AI never appears here: this panel presents only the deterministic release
 * request and the persisted human decision (AGENTS.md authority model).
 */
export function HumanApprovalPanel({
  release,
  approval,
  destination,
  network,
  interactive = false,
}: HumanApprovalPanelProps) {
  const decision = approval?.decision ?? null;
  const hasApprovalRequest = approval !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="size-4 text-muted-foreground" />
          Founder approval
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <MoneyMetric label="Exact release amount" amount={release.amount} emphasis="large" />

        <Separator />

        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Destination
            </dt>
            <dd className="break-all font-mono text-sm text-foreground">{destination}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Network
            </dt>
            <dd className="text-sm font-semibold text-foreground">{network}</dd>
          </div>
        </dl>

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <DecisionBadge decision={decision} />
          {approval?.decidedAt && (
            <span className="text-xs text-muted-foreground">
              Decided {new Date(approval.decidedAt).toLocaleString()}
            </span>
          )}
        </div>

        {interactive && hasApprovalRequest && decision === "PENDING" && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="sm:flex-1" disabled aria-disabled="true">
              Approve exact release
            </Button>
            <Button variant="outline" className="sm:flex-1" disabled aria-disabled="true">
              Reject
            </Button>
          </div>
        )}
        {interactive && hasApprovalRequest && decision === "PENDING" && (
          <p className="text-xs text-muted-foreground">
            Approval actions are disabled in this mock demonstration — no adapter is connected yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DecisionBadge({ decision }: { decision: ApprovalRecord["decision"] | null }) {
  if (decision === null) {
    return (
      <Badge variant="outline">
        <ShieldQuestion aria-hidden="true" className="size-3.5" />
        Approval not requested
      </Badge>
    );
  }
  if (decision === "APPROVED") {
    return (
      <Badge variant="success">
        <ShieldCheck aria-hidden="true" className="size-3.5" />
        Approved by founder
      </Badge>
    );
  }
  if (decision === "REJECTED") {
    return (
      <Badge variant="destructive">
        <ShieldX aria-hidden="true" className="size-3.5" />
        Rejected by founder
      </Badge>
    );
  }
  return (
    <Badge variant="warning">
      <ShieldQuestion aria-hidden="true" className="size-3.5" />
      Awaiting founder decision
    </Badge>
  );
}
