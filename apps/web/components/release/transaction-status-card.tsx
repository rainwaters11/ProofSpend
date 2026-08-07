import type { TransactionRecord } from "@proofspend/domain";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModeBadge } from "@/components/mode-badge";
import { ExplorerLink } from "@/components/release/explorer-link";
import { transactionStatusIcon } from "@/components/release/lifecycle-state-badge";

interface TransactionStatusCardProps {
  transaction: TransactionRecord;
}

const FIELD_LABEL = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

export function TransactionStatusCard({ transaction }: TransactionStatusCardProps) {
  const arc = transaction.arcTransaction;
  const Icon = arc ? transactionStatusIcon(arc.status) : transactionStatusIcon("NONE");

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
          Arc Testnet transaction
        </CardTitle>
        {arc && <ModeBadge mode={arc.isMock ? "mock" : "arc-testnet"} />}
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Operation</span>
          <span className="text-sm text-foreground">{arc?.operationType ?? "Not prepared yet"}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Network</span>
          <span className="text-sm text-foreground">{arc?.network ?? "—"}</span>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <span className={FIELD_LABEL}>Transaction hash</span>
          <ExplorerLink
            transactionHash={arc?.transactionHash ?? null}
            explorerUrl={arc?.explorerUrl ?? null}
            isMock={arc?.isMock ?? true}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Block number</span>
          <span className="text-sm text-foreground">{arc?.blockNumber ?? "Not confirmed yet"}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Block hash</span>
          <span className="break-all font-mono text-sm text-foreground">
            {arc?.blockHash ?? "Not confirmed yet"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
