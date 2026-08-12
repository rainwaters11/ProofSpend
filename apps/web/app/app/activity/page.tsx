import Link from "next/link";

import { ModeBadge } from "@/components/mode-badge";
import { formatMoney } from "@/lib/format-money";
import {
  resumeVerificationAgentAfterFounderCorrection,
  runVerificationAgent,
} from "@/lib/verification-agent";
import type { VerificationAgentResult } from "@/lib/verification-agent";
import { createPawPovAiEvidenceScenario } from "@proofspend/domain";

export const dynamic = "force-dynamic";

function adapterBadgeMode(adapterMode: "mock" | "arc-testnet") {
  return adapterMode === "mock" ? "mock" : "arc-testnet";
}

function formatCircleDecimal(atomicUnits: string): string {
  try {
    const value = BigInt(atomicUnits);
    const whole = value / 1_000_000n;
    const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return "—";
  }
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const { stage } = await searchParams;
  const showEvidenceGap = stage === "gap";
  let run: VerificationAgentResult;
  try {
    const now = new Date();
    const initialRun = await runVerificationAgent({
      agentMode: "mock",
      now: now.toISOString(),
    });
    const scenario = createPawPovAiEvidenceScenario();
    run = showEvidenceGap
      ? initialRun
      : resumeVerificationAgentAfterFounderCorrection({
          run: initialRun,
          authenticatedActorId: scenario.authorizedFounder.actorId,
          receipt: scenario.recoveryReceipt,
          acceptedMatch: scenario.recoveryMatch,
          now: new Date(now.getTime() + 1_000).toISOString(),
        });
  } catch {
    return (
      <div className="flex max-w-5xl flex-col gap-6">
        <h1 className="text-2xl font-semibold text-foreground">Verification Agent Activity</h1>
        <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">
          The deterministic mock preview is temporarily unavailable. No release proposal was prepared.
        </p>
      </div>
    );
  }

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
        <p className="text-sm text-muted-foreground">
          This public activity preview is deterministic mock data
          {showEvidenceGap ? " before founder correction." : ", including a seeded founder correction."}
          {" "}Live runs require the authenticated API boundary.
        </p>
        <nav aria-label="Preview verification stage" className="flex flex-wrap gap-2 pt-1">
          <Link
            href="/app/activity?stage=gap"
            aria-current={showEvidenceGap ? "page" : undefined}
            className="rounded-full border border-border px-3 py-2 text-xs font-medium text-foreground"
          >
            Evidence gap
          </Link>
          <Link
            href="/app/activity?stage=recovered"
            aria-current={!showEvidenceGap ? "page" : undefined}
            className="rounded-full border border-border px-3 py-2 text-xs font-medium text-foreground"
          >
            Recovered proposal
          </Link>
        </nav>
      </div>

      <section className="rounded-lg border border-border bg-surface p-4 md:p-6">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Run state</p>
          <p className="text-sm text-foreground">{run.status}</p>
          <p className="text-sm text-foreground">Question: {run.missingReceiptQuestion}</p>
          {run.proposal === null ? (
            <p className="border-t border-border pt-4 text-sm text-muted-foreground">
              A proposal cannot be prepared until the founder submits a validated receipt correction.
            </p>
          ) : (
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
                <dt className="text-muted-foreground">Atomic / Circle amount</dt>
                <dd className="font-medium text-foreground">
                  {run.proposal.amount.atomicUnits} atomic /{" "}
                  {formatCircleDecimal(run.proposal.amount.atomicUnits)} USDC
                </dd>
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
          )}
          {run.proposal !== null && (
            <div className="border-t border-border pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Deterministic requirement outcomes
              </p>
              <ul className="mt-3 space-y-2" aria-label="Deterministic requirement outcomes">
                {run.requirementOutcomes.map((requirement) => (
                  <li
                    key={requirement.requirementId}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground"
                  >
                    <span className="font-medium">{requirement.requirementId}</span>
                    <span>{requirement.outcome}</span>
                    <span className="text-muted-foreground">
                      {requirement.reasonCodes.join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
