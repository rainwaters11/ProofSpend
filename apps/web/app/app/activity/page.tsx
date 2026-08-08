import { ModeBadge } from "@/components/mode-badge";
import { formatMoney } from "@/lib/format-money";
import { runVerificationAgent } from "@/lib/verification-agent";

export const dynamic = "force-dynamic";

function adapterBadgeMode(adapterMode: "mock" | "arc-testnet") {
  return adapterMode === "mock" ? "mock" : "arc-testnet";
}

export default async function ActivityPage() {
  const run = await runVerificationAgent();

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-foreground">Verification Agent Activity</h1>
          <ModeBadge mode={adapterBadgeMode(run.adapterMode)} />
        </div>
        <p className="text-sm text-muted-foreground">
          Agent mode: <strong className="font-semibold text-foreground">{run.agentMode.toUpperCase()}</strong>
        </p>
      </div>

      <section className="rounded-lg border border-border bg-surface p-4 md:p-6">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Run state</p>
          <p className="text-sm text-foreground">{run.status}</p>
          <p className="text-sm text-foreground">Question: {run.missingReceiptQuestion}</p>
          <dl className="grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Action</dt>
              <dd className="font-medium text-foreground">Prepare release proposal</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="font-medium text-foreground">{formatMoney(run.proposal.amount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Asset and chain</dt>
              <dd className="font-medium text-foreground">
                {run.proposal.asset} on {run.proposal.chain}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Authorized role</dt>
              <dd className="font-medium text-foreground">{run.proposal.authorizedRole}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Destination</dt>
              <dd className="break-all font-mono text-xs text-foreground">
                {run.proposal.destination}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Expires</dt>
              <dd className="font-medium text-foreground">{run.proposal.expiresAt}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Idempotency reference</dt>
              <dd className="break-all font-mono text-xs text-foreground">
                {run.proposal.idempotencyKey}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 md:p-6">
        <h2 className="text-lg font-semibold text-foreground">Agent Activity Trace</h2>
        <ol className="mt-4 space-y-3" aria-label="Agent activity trace">
          {run.activityTrace.map((event) => (
            <li key={event.id} className="rounded-md border border-border bg-background p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-muted px-2 py-1 text-xs font-semibold text-foreground">
                  {event.layer}
                </span>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">{event.code}</span>
              </div>
              <p className="mt-1 text-sm text-foreground">{event.message}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
