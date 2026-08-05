import { ModeBadge } from "@/components/mode-badge";
import { MilestoneSummaryCard } from "@/components/release/milestone-summary-card";
import { buildReleaseScenario } from "@/lib/release-scenario";

export default function MilestonesPage() {
  const scenario = buildReleaseScenario();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-foreground">Milestones</h1>
        <ModeBadge mode="mock" />
      </div>

      <MilestoneSummaryCard
        milestone={scenario.milestone}
        href={`/app/milestones/${scenario.milestone.id}`}
      />
    </div>
  );
}
