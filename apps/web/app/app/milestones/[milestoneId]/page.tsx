import { ModeBadge } from "@/components/mode-badge";
import { EmptyState } from "@/components/release/state-view";
import { HumanApprovalPanel } from "@/components/release/human-approval-panel";
import { LifecycleCallout } from "@/components/release/lifecycle-callout";
import { LifecycleStateSwitcher } from "@/components/release/lifecycle-state-switcher";
import { ReleaseLifecycleTimeline } from "@/components/release/release-lifecycle-timeline";
import { ReleaseRequestCard } from "@/components/release/release-request-card";
import { RequirementChecklist } from "@/components/release/requirement-checklist";
import { TransactionStatusCard } from "@/components/release/transaction-status-card";
import {
  buildReleaseScenario,
  type ReleaseLifecycleState,
} from "@/lib/release-scenario";
import { ARC_TESTNET_NETWORK } from "@proofspend/domain";

const VALID_STATES = new Set<ReleaseLifecycleState>([
  "DRAFT",
  "ELIGIBLE",
  "APPROVAL_PENDING",
  "APPROVED",
  "PREPARED",
  "SUBMITTED",
  "CONFIRMED",
  "RECONCILED",
  "REJECTED",
  "FAILED",
]);

function isReleaseLifecycleState(value: string | undefined): value is ReleaseLifecycleState {
  return value !== undefined && VALID_STATES.has(value as ReleaseLifecycleState);
}

/**
 * Screens 2–4: release request, human approval, and transaction
 * progression, composed into one milestone workspace. AI recommendation,
 * deterministic policy result, and human approval stay in separate,
 * clearly labeled panels — never collapsed into one generic status
 * (Issue #14 milestone-detail requirement).
 */
export default async function MilestoneDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ milestoneId: string }>;
  searchParams: Promise<{ state?: string }>;
}) {
  const { milestoneId: rawMilestoneId } = await params;
  const { state: requestedState } = await searchParams;
  const scenario = buildReleaseScenario();

  let milestoneId: string;
  try {
    milestoneId = decodeURIComponent(rawMilestoneId);
  } catch {
    milestoneId = rawMilestoneId;
  }

  if (milestoneId !== scenario.milestone.id) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <h1 className="text-2xl font-semibold text-foreground">Milestone detail</h1>
        <EmptyState
          title="Milestone not found"
          description={`No milestone matches "${milestoneId}" in this mock scenario. Try the PawPOVAI demo milestone from the Milestones list.`}
        />
      </div>
    );
  }

  const activeState: ReleaseLifecycleState = isReleaseLifecycleState(requestedState)
    ? requestedState
    : "APPROVAL_PENDING";
  const snapshot = scenario.snapshots[activeState];

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-foreground">{scenario.milestone.title}</h1>
          <ModeBadge mode="mock" />
        </div>
        <p className="text-sm text-muted-foreground">{scenario.project.name}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Preview a lifecycle state
        </span>
        <LifecycleStateSwitcher milestoneId={scenario.milestone.id} current={activeState} />
      </div>

      <div className="rounded-lg border border-border bg-surface p-4 md:p-6">
        <ReleaseLifecycleTimeline current={activeState} />
      </div>

      <LifecycleCallout
        state={activeState}
        reconciliation={snapshot.reconciliation}
        isMock={snapshot.transaction?.arcTransaction?.isMock ?? true}
      />

      <RequirementChecklist requirements={scenario.requirements} />

      <ReleaseRequestCard
        release={snapshot.release}
        purpose="Cover confirmed launch-identity, landing-page, and InvestFest promotional deliverables plus two reconciled expense records within the founder-confirmed 150 USDC eligible spend limit."
        destination="mock:destination:pawpovai-operating-wallet"
        evidence={scenario.evidence}
      />

      <HumanApprovalPanel
        release={snapshot.release}
        approval={snapshot.approval}
        destination="mock:destination:pawpovai-operating-wallet"
        network={ARC_TESTNET_NETWORK}
        interactive
      />

      {snapshot.transaction && <TransactionStatusCard transaction={snapshot.transaction} />}
    </div>
  );
}
