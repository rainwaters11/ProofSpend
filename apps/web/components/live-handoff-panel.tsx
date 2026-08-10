import type { HandoffResult } from "@/lib/verification-agent";

const stateCopy = {
  NOT_SUBMITTED: "Not submitted",
  SKIPPED_MOCK: "Mock only",
  SUBMITTED: "Submitted to Circle",
  CONFIRMED: "Confirmed on Arc Testnet",
  FAILED: "Failed closed",
} as const;

export function LiveHandoffPanel({ result }: { result: HandoffResult }) {
  const execution = result.execution;
  return (
    <section
      className="rounded-lg border border-border bg-surface p-4 md:p-6"
      aria-labelledby="live-handoff-heading"
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Live settlement result
          </p>
          <h2 id="live-handoff-heading" className="mt-1 text-lg font-semibold text-foreground">
            {stateCopy[execution.state]}
          </h2>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="font-medium text-foreground">1.00 USDC</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Network</dt>
            <dd className="font-medium text-foreground">ARC TESTNET</dd>
          </div>
          {execution.providerOperationId && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Circle operation</dt>
              <dd className="break-all font-mono text-xs text-foreground">
                {execution.providerOperationId}
              </dd>
            </div>
          )}
          {execution.state === "CONFIRMED" && execution.transactionHash && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Arc transaction hash</dt>
              <dd className="break-all font-mono text-xs text-foreground">
                {execution.transactionHash}
              </dd>
            </div>
          )}
        </dl>
        {execution.state === "CONFIRMED" && execution.explorerUrl && execution.transactionHash && (
          <a
            className="w-fit text-sm font-medium text-primary underline underline-offset-4"
            href={execution.explorerUrl}
            target="_blank"
            rel="noreferrer"
          >
            View the real transaction on Arcscan
          </a>
        )}
        {execution.reconciliation?.state === "RECONCILED" && (
          <div
            role="status"
            className="rounded-md border border-border bg-background p-3 text-sm"
          >
            <p className="font-medium text-foreground">Reconciled</p>
            <p className="mt-1 text-muted-foreground">
              The Arc confirmation is durably linked to this handoff record.
            </p>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Reconciliation record</dt>
                <dd className="break-all font-mono text-xs text-foreground">
                  {execution.reconciliation.reconciliationId}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Reconciled at</dt>
                <dd className="font-mono text-xs text-foreground">
                  {execution.reconciliation.reconciledAt}
                </dd>
              </div>
            </dl>
          </div>
        )}
        {execution.state === "SUBMITTED" && execution.failureMessage && (
          <p role="status" className="text-sm text-muted-foreground">
            {execution.failureMessage}
          </p>
        )}
        {execution.state === "FAILED" && (
          <p role="alert" className="text-sm text-destructive">
            {execution.failureMessage ?? "The transfer failed closed. No confirmation is claimed."}
          </p>
        )}
      </div>
    </section>
  );
}
