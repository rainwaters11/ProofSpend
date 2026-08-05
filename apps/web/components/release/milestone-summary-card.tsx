import Link from "next/link";
import { ArrowRight } from "lucide-react";

import type { Milestone } from "@proofspend/domain";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyMetric } from "@/components/release/money-metric";

interface MilestoneSummaryCardProps {
  milestone: Milestone;
  href: string;
}

const STATUS_VARIANT: Record<Milestone["status"], "outline" | "warning" | "success" | "destructive" | "secondary"> = {
  INCOMPLETE: "outline",
  NEEDS_REVIEW: "warning",
  ELIGIBLE: "secondary",
  APPROVAL_PENDING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
};

export function MilestoneSummaryCard({ milestone, href }: MilestoneSummaryCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle>{milestone.title}</CardTitle>
        <Badge variant={STATUS_VARIANT[milestone.status]}>{milestone.status.replace("_", " ")}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <MoneyMetric label="Proposed amount" amount={milestone.proposedAmount} />
        <Link
          href={href}
          className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          View milestone and release lifecycle
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </CardContent>
    </Card>
  );
}
