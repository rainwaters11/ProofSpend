import { FileCheck2 } from "lucide-react";

import type { ReleaseRequest } from "@proofspend/domain";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LifecycleStateBadge } from "@/components/release/lifecycle-state-badge";
import { MoneyMetric } from "@/components/release/money-metric";
import type { ReleaseEvidenceRef } from "@/lib/release-scenario";

interface ReleaseRequestCardProps {
  release: ReleaseRequest;
  purpose: string;
  destination: string;
  evidence: ReleaseEvidenceRef[];
}

const KIND_LABEL: Record<ReleaseEvidenceRef["item"]["kind"], string> = {
  RECEIPT: "Receipt",
  SCREENSHOT: "Screenshot",
  INVOICE: "Invoice",
  DELIVERABLE: "Deliverable",
  STATEMENT: "Statement",
  CONFIRMATION: "Confirmation",
};

/** Screen 2: release request showing amount, recipient, purpose, and evidence. */
export function ReleaseRequestCard({ release, purpose, destination, evidence }: ReleaseRequestCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle>Release request</CardTitle>
        <LifecycleStateBadge state={release.state} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyMetric label="Amount" amount={release.amount} emphasis="large" />
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Recipient
            </span>
            <span className="break-all font-mono text-sm text-foreground">{destination}</span>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Purpose
          </span>
          <p className="text-sm leading-relaxed text-foreground">{purpose}</p>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Supporting evidence ({evidence.length})
          </span>
          {evidence.length === 0 ? (
            <p className="text-sm text-muted-foreground">No evidence attached yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {evidence.map((entry) => (
                <li
                  key={entry.item.id}
                  className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2"
                >
                  <FileCheck2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">
                      {KIND_LABEL[entry.item.kind]}
                    </span>
                    <span className="text-xs text-muted-foreground">{entry.matchExplanation}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
