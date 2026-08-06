import { ModeBadge } from "@/components/mode-badge";
import { MilestoneSummaryCard } from "@/components/release/milestone-summary-card";
import { MoneyMetric } from "@/components/release/money-metric";
import { RequirementChecklist } from "@/components/release/requirement-checklist";
import { buildReleaseScenario } from "@/lib/release-scenario";

/**
 * Screen 1 — project and milestone overview. Data is the frozen mock
 * PawPOVAI scenario (lib/release-scenario.ts), not a live Treasury or
 * Milestone Engine (Issues #3/#4 are still open) — the MOCK badge and the
 * banner below keep that boundary visible per AGENTS.md UI rules.
 */
export default function OverviewPage() {
  const scenario = buildReleaseScenario();

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-foreground">{scenario.project.name}</h1>
          <ModeBadge mode="mock" />
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">{scenario.project.description}</p>
      </div>

      <div className="rounded-lg border border-mode-mock/40 bg-mode-mock/10 px-4 py-3 text-sm text-foreground">
        This screen renders the release-lifecycle demonstration scenario. Every amount, evidence
        item, and transaction reference below is synthetic seed data — see{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
          apps/web/lib/release-scenario.ts
        </code>
        . Real Treasury and Milestone Engine wiring lands with Issues #3 and #4.
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <MoneyMetric label="Total capital" amount={scenario.vault.totalCapital} emphasis="large" />
        <MoneyMetric label="Milestone amount" amount={scenario.milestone.proposedAmount} emphasis="large" />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Requirements
          </span>
          <span className="text-2xl font-semibold tabular-nums text-foreground md:text-3xl">
            {scenario.requirements.length}
          </span>
        </div>
      </div>

      <RequirementChecklist requirements={scenario.requirements} />

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">Current milestone</h2>
        <MilestoneSummaryCard
          milestone={scenario.milestone}
          href={`/app/milestones/${scenario.milestone.id}`}
        />
      </div>
    </div>
  );
}
