import "server-only";

import {
  arcTestnetExplorerTransactionUrl,
  createPawPovAiSeed,
  filterBackerDisclosure,
  type ApprovalRecord,
  type ArcTransactionRef,
  type Actor,
  type EvidenceItem,
  type Milestone,
  type MilestoneRequirement,
  type ProofOfProgress,
  type ReconciliationRecord,
  type ReleaseRequest,
  type SettlementRecord,
  type TransactionRecord,
} from "@proofspend/domain";

/**
 * Every ID, address, and hash here starts with `mock:` or `synthetic:` so it
 * fails the domain's own `isSynthetic` gate if anyone ever tried to render it
 * as live (see packages/domain/src/models.ts). This module produces one
 * frozen snapshot of the release lifecycle per application state so Phase A
 * screens can render every required state without a running adapter.
 *
 * This is demonstration data only — Issues #3 (Treasury), #4 (Milestone
 * Engine), and #7 (Circle execution ADR) own the real orchestration that
 * will eventually produce these records. See docs/roadmap.md.
 */

const OCCURRED_AT = "2026-01-20T15:00:00.000Z";
const APPROVED_AT = "2026-01-20T14:55:00.000Z";
const EXPIRES_AT = "2026-01-27T14:55:00.000Z";

const founder: Actor = { actorId: "mock:founder:pawpovai", actorType: "FOUNDER" };
const adapter: Actor = { actorId: "mock:adapter:circle", actorType: "ADAPTER" };

const RELEASE_ID = "release:milestone-launch-ready";
const INTENT_ID = "intent:milestone-launch-ready";
const APPROVAL_ID = "approval:milestone-launch-ready";
const TRANSACTION_ID = "transaction:milestone-launch-ready";
const RECONCILIATION_ID = "reconciliation:milestone-launch-ready";
const SETTLEMENT_ID = "settlement:milestone-launch-ready";
const DESTINATION = "mock:destination:pawpovai-operating-wallet";
const EXACT_INTENT_HASH = `sha256:${"4".repeat(64)}`;
const MOCK_TX_HASH = "mock:tx:milestone-launch-ready";
const MOCK_BLOCK_HASH = "mock:block:milestone-launch-ready";

export type ReleaseLifecycleState = ReleaseRequest["state"];

export interface ReleaseEvidenceRef {
  item: EvidenceItem;
  requirementId: string;
  matchExplanation: string;
}

export interface ReleaseScenarioSnapshot {
  key: ReleaseLifecycleState;
  label: string;
  release: ReleaseRequest;
  approval: ApprovalRecord | null;
  transaction: TransactionRecord | null;
  settlement: SettlementRecord | null;
  reconciliation: ReconciliationRecord | null;
}

export interface ReleaseScenario {
  project: ReturnType<typeof createPawPovAiSeed>["project"];
  vault: ReturnType<typeof createPawPovAiSeed>["vault"];
  milestone: Milestone;
  requirements: MilestoneRequirement[];
  evidence: ReleaseEvidenceRef[];
  proof: ProofOfProgress;
  snapshots: Record<ReleaseLifecycleState, ReleaseScenarioSnapshot>;
  approver: Actor;
  adapter: Actor;
}

const arcTx = (
  status: ArcTransactionRef["status"],
  overrides: Partial<ArcTransactionRef> = {},
): ArcTransactionRef => ({
  network: "ARC_TESTNET",
  chainId: "synthetic:chain",
  transactionHash: status === "SUBMITTED" || status === "CONFIRMED" ? MOCK_TX_HASH : null,
  status,
  blockNumber: status === "CONFIRMED" ? "1" : null,
  blockHash: status === "CONFIRMED" ? MOCK_BLOCK_HASH : null,
  explorerUrl: null,
  operationType: "SETTLEMENT",
  isMock: true,
  ...overrides,
});

const baseRelease = (
  state: ReleaseLifecycleState,
  overrides: Partial<ReleaseRequest> = {},
): ReleaseRequest => ({
  id: RELEASE_ID,
  projectId: "project:pawpovai",
  milestoneId: "milestone:launch-ready",
  proofId: "proof:milestone-launch-ready:v1",
  intentId: INTENT_ID,
  settlementId: null,
  amount: { asset: "USDC", atomicUnits: "150000000" },
  state,
  approvalId: null,
  idempotencyKey: "release:milestone-launch-ready:key",
  createdAt: "2026-01-18T09:00:00.000Z",
  ...overrides,
});

const baseTransaction = (
  operationState: TransactionRecord["operationState"],
  arcStatus: ArcTransactionRef["status"],
  overrides: Partial<TransactionRecord> = {},
): TransactionRecord => ({
  id: TRANSACTION_ID,
  projectId: "project:pawpovai",
  releaseRequestId: RELEASE_ID,
  intentId: INTENT_ID,
  destinationReference: DESTINATION,
  approvalId: APPROVAL_ID,
  approvalBindingId: "binding:milestone-launch-ready",
  reconciliationId: null,
  idempotencyKey: "transaction:milestone-launch-ready:key",
  amount: { asset: "USDC", atomicUnits: "150000000" },
  operationState,
  arcTransaction: arcTx(arcStatus),
  createdAt: "2026-01-20T14:55:30.000Z",
  updatedAt: OCCURRED_AT,
  ...overrides,
});

const approval: ApprovalRecord = {
  id: APPROVAL_ID,
  aggregateId: RELEASE_ID,
  intentId: INTENT_ID,
  exactIntentHash: EXACT_INTENT_HASH,
  idempotencyKey: "approval:milestone-launch-ready:key",
  decision: "APPROVED",
  approver: founder,
  expiresAt: EXPIRES_AT,
  decidedAt: APPROVED_AT,
  actionKind: "RELEASE_APPROVAL",
  authorizedActorType: "FOUNDER",
  authorizedActorId: founder.actorId,
};

const pendingApproval: ApprovalRecord = {
  ...approval,
  decision: "PENDING",
  approver: null,
  decidedAt: null,
};

const rejectedApproval: ApprovalRecord = {
  ...approval,
  decision: "REJECTED",
};

function buildSnapshot(key: ReleaseLifecycleState): ReleaseScenarioSnapshot {
  switch (key) {
    case "DRAFT":
      return { key, label: "Draft", release: baseRelease("DRAFT"), approval: null, transaction: null, settlement: null, reconciliation: null };
    case "ELIGIBLE":
      return { key, label: "Eligible", release: baseRelease("ELIGIBLE"), approval: null, transaction: null, settlement: null, reconciliation: null };
    case "APPROVAL_PENDING":
      return {
        key,
        label: "Awaiting founder approval",
        release: baseRelease("APPROVAL_PENDING"),
        approval: pendingApproval,
        transaction: null,
        settlement: null,
        reconciliation: null,
      };
    case "APPROVED":
      return {
        key,
        label: "Approved",
        release: baseRelease("APPROVED", { approvalId: APPROVAL_ID }),
        approval,
        transaction: null,
        settlement: null,
        reconciliation: null,
      };
    case "PREPARED":
      return {
        key,
        label: "Prepared",
        release: baseRelease("PREPARED", { approvalId: APPROVAL_ID }),
        approval,
        transaction: baseTransaction("PREPARED", "PREPARED"),
        settlement: null,
        reconciliation: null,
      };
    case "SUBMITTED":
      return {
        key,
        label: "Submitted",
        release: baseRelease("SUBMITTED", { approvalId: APPROVAL_ID }),
        approval,
        transaction: baseTransaction("SUBMITTED", "SUBMITTED"),
        settlement: {
          id: SETTLEMENT_ID,
          projectId: "project:pawpovai",
          releaseRequestId: RELEASE_ID,
          reconciliationId: null,
          idempotencyKey: "settlement:milestone-launch-ready:key",
          amount: { asset: "USDC", atomicUnits: "150000000" },
          state: "PENDING",
          job: null,
          transaction: arcTx("SUBMITTED"),
          updatedAt: OCCURRED_AT,
        },
        reconciliation: null,
      };
    case "CONFIRMED": {
      const confirmedTx = arcTx("CONFIRMED", {
        explorerUrl: null,
      });
      return {
        key,
        label: "Confirmed",
        release: baseRelease("CONFIRMED", { approvalId: APPROVAL_ID, settlementId: SETTLEMENT_ID }),
        approval,
        transaction: baseTransaction("CONFIRMED", "CONFIRMED"),
        settlement: {
          id: SETTLEMENT_ID,
          projectId: "project:pawpovai",
          releaseRequestId: RELEASE_ID,
          reconciliationId: null,
          idempotencyKey: "settlement:milestone-launch-ready:key",
          amount: { asset: "USDC", atomicUnits: "150000000" },
          state: "CONFIRMED",
          job: null,
          transaction: confirmedTx,
          updatedAt: OCCURRED_AT,
        },
        reconciliation: null,
      };
    }
    case "RECONCILED": {
      const confirmedTx = arcTx("CONFIRMED");
      return {
        key,
        label: "Reconciled",
        release: baseRelease("RECONCILED", { approvalId: APPROVAL_ID, settlementId: SETTLEMENT_ID }),
        approval,
        transaction: baseTransaction("RECONCILED", "CONFIRMED", { reconciliationId: RECONCILIATION_ID }),
        settlement: {
          id: SETTLEMENT_ID,
          projectId: "project:pawpovai",
          releaseRequestId: RELEASE_ID,
          reconciliationId: RECONCILIATION_ID,
          idempotencyKey: "settlement:milestone-launch-ready:key",
          amount: { asset: "USDC", atomicUnits: "150000000" },
          state: "RECONCILED",
          job: null,
          transaction: confirmedTx,
          updatedAt: OCCURRED_AT,
        },
        reconciliation: {
          id: RECONCILIATION_ID,
          projectId: "project:pawpovai",
          transactionRecordId: TRANSACTION_ID,
          settlementId: SETTLEMENT_ID,
          result: "MATCHED",
          evidenceReference: "mock:reconciliation-report:milestone-launch-ready",
          reconciledAt: "2026-01-20T15:05:00.000Z",
          actor: { actorId: adapter.actorId, actorType: "ADAPTER" },
        },
      };
    }
    case "REJECTED":
      return {
        key,
        label: "Rejected",
        release: baseRelease("REJECTED", { approvalId: APPROVAL_ID }),
        approval: rejectedApproval,
        transaction: null,
        settlement: null,
        reconciliation: null,
      };
    case "FAILED":
      return {
        key,
        label: "Failed",
        release: baseRelease("FAILED", { approvalId: APPROVAL_ID }),
        approval,
        transaction: baseTransaction("FAILED", "FAILED", {
          arcTransaction: arcTx("FAILED", { transactionHash: null }),
        }),
        settlement: null,
        reconciliation: null,
      };
  }
}

const LIFECYCLE_KEYS: ReleaseLifecycleState[] = [
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
];

export function buildReleaseScenario(): ReleaseScenario {
  const seed = createPawPovAiSeed();
  // seed.milestone.status is INCOMPLETE — the Milestone Engine (Issue #4)
  // that would compute a real ELIGIBLE/APPROVED/REJECTED status does not
  // exist yet, so this demo never overrides it with a fabricated status.
  const milestone: Milestone = seed.milestone;
  const requirements = seed.requirements;

  const evidence: ReleaseEvidenceRef[] = [
    {
      item: {
        id: "evidence:identity",
        projectId: seed.project.id,
        kind: "DELIVERABLE",
        sourceHash: `sha256:${"a".repeat(64)}`,
        storageRef: "mock://evidence/identity.png",
        visibility: "FOUNDER_PRIVATE",
        submittedAt: "2026-01-16T10:00:00.000Z",
      },
      requirementId: "requirement:identity",
      matchExplanation: "Visual identity asset matches the requirement's deliverable request.",
    },
    {
      item: {
        id: "evidence:landing",
        projectId: seed.project.id,
        kind: "SCREENSHOT",
        sourceHash: `sha256:${"b".repeat(64)}`,
        storageRef: "mock://evidence/landing.png",
        visibility: "FOUNDER_PRIVATE",
        submittedAt: "2026-01-17T10:00:00.000Z",
      },
      requirementId: "requirement:landing",
      matchExplanation: "Landing-page screenshot matches the requirement's deliverable request.",
    },
    {
      item: {
        id: "evidence:flyer",
        projectId: seed.project.id,
        kind: "DELIVERABLE",
        sourceHash: `sha256:${"c".repeat(64)}`,
        storageRef: "mock://evidence/flyer.png",
        visibility: "FOUNDER_PRIVATE",
        submittedAt: "2026-01-17T15:00:00.000Z",
      },
      requirementId: "requirement:flyer",
      matchExplanation: "Promotional flyer matches the requirement's deliverable request.",
    },
    {
      item: {
        id: "evidence:expense-1",
        projectId: seed.project.id,
        kind: "RECEIPT",
        sourceHash: `sha256:${"d".repeat(64)}`,
        storageRef: "mock://evidence/receipt-1.pdf",
        visibility: "FOUNDER_PRIVATE",
        submittedAt: "2026-01-18T09:00:00.000Z",
      },
      requirementId: "requirement:expenses",
      matchExplanation: "Receipt one of two required expense records.",
    },
    {
      item: {
        id: "evidence:expense-2",
        projectId: seed.project.id,
        kind: "RECEIPT",
        sourceHash: `sha256:${"e".repeat(64)}`,
        storageRef: "mock://evidence/receipt-2.pdf",
        visibility: "FOUNDER_PRIVATE",
        submittedAt: "2026-01-18T09:05:00.000Z",
      },
      requirementId: "requirement:expenses",
      matchExplanation: "Receipt two of two required expense records.",
    },
    {
      item: {
        id: "evidence:confirmation",
        projectId: seed.project.id,
        kind: "CONFIRMATION",
        sourceHash: `sha256:${"f".repeat(64)}`,
        storageRef: "mock://evidence/founder-confirmation.txt",
        visibility: "FOUNDER_PRIVATE",
        submittedAt: "2026-01-18T09:10:00.000Z",
      },
      requirementId: "requirement:confirmation",
      matchExplanation: "Founder confirmed spend stayed within the 150 USDC eligible limit.",
    },
  ];

  const proof: ProofOfProgress = {
    id: "proof:milestone-launch-ready:v1",
    projectId: seed.project.id,
    milestoneId: milestone.id,
    version: 1,
    approvedEvidenceHashes: evidence.map((entry) => entry.item.sourceHash),
    recordHash: `sha256:${"9".repeat(64)}`,
    visibility: "BACKER_SHARED",
    createdAt: "2026-01-19T12:00:00.000Z",
  };

  const snapshots = Object.fromEntries(
    LIFECYCLE_KEYS.map((key) => [key, buildSnapshot(key)]),
  ) as Record<ReleaseLifecycleState, ReleaseScenarioSnapshot>;

  return {
    project: seed.project,
    vault: seed.vault,
    milestone,
    requirements,
    evidence,
    proof,
    snapshots,
    approver: founder,
    adapter,
  };
}

export function explorerUrlFor(transactionHash: string): string {
  return arcTestnetExplorerTransactionUrl(transactionHash);
}

export function buildBackerDisclosure(scenario: ReleaseScenario) {
  const confirmedSettlement = scenario.snapshots.RECONCILED.settlement;
  return filterBackerDisclosure({
    project: scenario.project,
    evidence: scenario.evidence.map((entry) => entry.item),
    proofs: [scenario.proof],
    settlements: confirmedSettlement ? [confirmedSettlement] : [],
    preferences: {
      projectId: scenario.project.id,
      discloseCapitalSummary: true,
      discloseRequirementOutcomes: true,
      discloseProofRecords: true,
      discloseSettlementState: true,
      approvedProofIds: [scenario.proof.id],
      updatedAt: "2026-01-20T15:10:00.000Z",
    },
  });
}
