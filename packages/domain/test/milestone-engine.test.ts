import { describe, expect, it } from "vitest";
import {
  AgenticJobStatusSchema,
  ApprovalRecordSchema,
  EvidenceItemSchema,
  EvidenceMatchSchema,
  ReleaseRequestSchema,
  SettlementMoneyAmountSchema,
  assertErc8183Transition,
  createAgenticJobDraft,
  evaluateMilestone,
  hashCanonicalMilestoneEvaluationApprovalSubject,
  isAllowedErc8183Transition,
  type AgenticJobStatus,
  type MilestoneEvaluationInput,
  type MilestoneRequirement,
} from "../src";

const usdc = (atomicUnits: string) => SettlementMoneyAmountSchema.parse({ asset: "USDC", atomicUnits });
const requirementIds = ["req:deliverable", "req:expenses", "req:spend", "req:confirmation", "req:tx", "req:purpose", "req:due", "req:approval"];
const milestone = {
  id: "milestone:launch",
  projectId: "project:launch",
  title: "Launch tranche",
  proposedAmount: usdc("150000000"),
  status: "INCOMPLETE" as const,
  requirementIds,
  dueAt: "2026-02-01T00:00:00.000Z",
};
const baseRequirements: MilestoneRequirement[] = [
  { id: "req:deliverable", milestoneId: milestone.id, kind: "DELIVERABLE", description: "Deliverable proof" },
  { id: "req:expenses", milestoneId: milestone.id, kind: "EXPENSE_RECORDS", description: "Receipts", requiredCount: 2 },
  { id: "req:spend", milestoneId: milestone.id, kind: "SPEND_LIMIT", description: "Spend cap", spendLimit: usdc("150000000") },
  { id: "req:confirmation", milestoneId: milestone.id, kind: "FOUNDER_CONFIRMATION", description: "Founder sign-off" },
  { id: "req:tx", milestoneId: milestone.id, kind: "TRANSACTION_MATCH", description: "Transaction match" },
  { id: "req:purpose", milestoneId: milestone.id, kind: "BUSINESS_PURPOSE", description: "Business purpose" },
  { id: "req:due", milestoneId: milestone.id, kind: "DUE_DATE", description: "Due date" },
  { id: "req:approval", milestoneId: milestone.id, kind: "HUMAN_APPROVAL", description: "Human approval" },
];
const evaluatedAt = "2026-01-20T00:00:00.000Z";
const policyVersion = "policy:v1";
const approvalIntentId = "intent:exact";
const authorizedEvaluatorId = "evaluator:1";
const authorizedFounderId = "founder:1";
const baseEvidenceItems = () => ([
  EvidenceItemSchema.parse({ id: "evidence:deliverable", projectId: milestone.projectId, kind: "DELIVERABLE", sourceHash: `sha256:${"1".repeat(64)}`, storageRef: "private://deliverable", visibility: "FOUNDER_PRIVATE", submittedAt: evaluatedAt }),
  EvidenceItemSchema.parse({ id: "evidence:receipt:1", projectId: milestone.projectId, kind: "RECEIPT", sourceHash: `sha256:${"2".repeat(64)}`, storageRef: "private://receipt:1", visibility: "FOUNDER_PRIVATE", submittedAt: evaluatedAt }),
  EvidenceItemSchema.parse({ id: "evidence:receipt:2", projectId: milestone.projectId, kind: "RECEIPT", sourceHash: `sha256:${"3".repeat(64)}`, storageRef: "private://receipt:2", visibility: "FOUNDER_PRIVATE", submittedAt: evaluatedAt }),
  EvidenceItemSchema.parse({ id: "evidence:confirmation", projectId: milestone.projectId, kind: "CONFIRMATION", sourceHash: `sha256:${"4".repeat(64)}`, storageRef: "private://confirmation", visibility: "FOUNDER_PRIVATE", submittedAt: evaluatedAt }),
  EvidenceItemSchema.parse({ id: "evidence:tx:match", projectId: milestone.projectId, kind: "STATEMENT", sourceHash: `sha256:${"5".repeat(64)}`, storageRef: "private://tx-match", visibility: "FOUNDER_PRIVATE", submittedAt: evaluatedAt }),
  EvidenceItemSchema.parse({ id: "evidence:purpose", projectId: milestone.projectId, kind: "SCREENSHOT", sourceHash: `sha256:${"6".repeat(64)}`, storageRef: "private://purpose", visibility: "FOUNDER_PRIVATE", submittedAt: evaluatedAt }),
  EvidenceItemSchema.parse({ id: "evidence:due", projectId: milestone.projectId, kind: "INVOICE", sourceHash: `sha256:${"7".repeat(64)}`, storageRef: "private://due", visibility: "FOUNDER_PRIVATE", submittedAt: evaluatedAt }),
]);
const baseEvidenceMatches = () => ([
  EvidenceMatchSchema.parse({ id: "match:deliverable", source: "HUMAN_DECISION", evidenceId: "evidence:deliverable", requirementId: "req:deliverable", confidenceBasisPoints: null, explanation: "accepted deliverable", acceptedBy: { actorType: "EVALUATOR", actorId: authorizedEvaluatorId } }),
  EvidenceMatchSchema.parse({ id: "match:receipt:1", source: "HUMAN_DECISION", evidenceId: "evidence:receipt:1", requirementId: "req:expenses", confidenceBasisPoints: null, explanation: "accepted receipt", acceptedBy: { actorType: "EVALUATOR", actorId: authorizedEvaluatorId } }),
  EvidenceMatchSchema.parse({ id: "match:receipt:2", source: "HUMAN_DECISION", evidenceId: "evidence:receipt:2", requirementId: "req:expenses", confidenceBasisPoints: null, explanation: "accepted receipt", acceptedBy: { actorType: "EVALUATOR", actorId: authorizedEvaluatorId } }),
  EvidenceMatchSchema.parse({ id: "match:confirmation", source: "HUMAN_DECISION", evidenceId: "evidence:confirmation", requirementId: "req:confirmation", confidenceBasisPoints: null, explanation: "accepted confirmation", acceptedBy: { actorType: "FOUNDER", actorId: authorizedFounderId } }),
  EvidenceMatchSchema.parse({ id: "match:tx", source: "HUMAN_DECISION", evidenceId: "evidence:tx:match", requirementId: "req:tx", confidenceBasisPoints: null, explanation: "accepted tx match", acceptedBy: { actorType: "EVALUATOR", actorId: authorizedEvaluatorId } }),
  EvidenceMatchSchema.parse({ id: "match:purpose", source: "HUMAN_DECISION", evidenceId: "evidence:purpose", requirementId: "req:purpose", confidenceBasisPoints: null, explanation: "accepted purpose", acceptedBy: { actorType: "EVALUATOR", actorId: authorizedEvaluatorId } }),
]);

function baseObservations() {
  return {
    "req:deliverable": { evidenceReferences: ["evidence:deliverable"], deliverableCount: 1 },
    "req:expenses": { evidenceReferences: ["evidence:receipt:1", "evidence:receipt:2"], receiptCount: 2 },
    "req:confirmation": { evidenceReferences: ["evidence:confirmation"], founderConfirmationPresent: true },
    "req:tx": { evidenceReferences: ["evidence:tx:match"], transactionMatched: true },
    "req:purpose": { evidenceReferences: ["evidence:purpose"], businessPurposePresent: true },
    "req:due": { evidenceReferences: ["evidence:due"] },
    "req:approval": { evidenceReferences: ["approval:exact"] },
  };
}

const approvalInput = (overrides: Partial<MilestoneEvaluationInput> = {}): MilestoneEvaluationInput => ({
  milestone: overrides.milestone ?? milestone,
  requirements: overrides.requirements ?? baseRequirements,
  observations: overrides.observations ?? baseObservations(),
  evidenceItems: overrides.evidenceItems ?? baseEvidenceItems(),
  evidenceMatches: overrides.evidenceMatches ?? baseEvidenceMatches(),
  verifiedSpend: overrides.verifiedSpend ?? usdc("150000000"),
  evaluatedAt: overrides.evaluatedAt ?? evaluatedAt,
  policyVersion: overrides.policyVersion ?? policyVersion,
  approvalRecord: overrides.approvalRecord,
  expectedApprovalIntentId: overrides.expectedApprovalIntentId ?? approvalIntentId,
  expectedAuthorizedEvaluatorId: overrides.expectedAuthorizedEvaluatorId ?? authorizedEvaluatorId,
  expectedAuthorizedFounderId: overrides.expectedAuthorizedFounderId ?? authorizedFounderId,
  reviewerNotesByRequirementId: overrides.reviewerNotesByRequirementId,
  expectedApprovalExactIntentHash: overrides.expectedApprovalExactIntentHash,
});
const approvalHashFor = (input: MilestoneEvaluationInput): string => hashCanonicalMilestoneEvaluationApprovalSubject({
  milestone: input.milestone,
  requirements: input.requirements,
  observations: input.observations,
  evidenceItems: input.evidenceItems,
  evidenceMatches: input.evidenceMatches,
  verifiedSpend: input.verifiedSpend,
  policyVersion: input.policyVersion,
  evaluatedAt: input.evaluatedAt,
  expectedApprovalIntentId: input.expectedApprovalIntentId,
  expectedAuthorizedEvaluatorId: input.expectedAuthorizedEvaluatorId,
  expectedAuthorizedFounderId: input.expectedAuthorizedFounderId,
});
const exactApprovalFor = (input: MilestoneEvaluationInput) => ApprovalRecordSchema.parse({
  id: "approval:exact",
  aggregateId: input.milestone.id,
  intentId: approvalIntentId,
  actionKind: "MILESTONE_EVALUATION",
  authorizedActorType: "EVALUATOR",
  authorizedActorId: authorizedEvaluatorId,
  exactIntentHash: approvalHashFor(input),
  idempotencyKey: "approval:key:exact",
  decision: "APPROVED",
  approver: { actorId: authorizedEvaluatorId, actorType: "EVALUATOR" },
  expiresAt: "2026-01-30T00:00:00.000Z",
  decidedAt: "2026-01-19T00:00:00.000Z",
});
const baselineApprovalInput = approvalInput();
const exactApproval = exactApprovalFor(baselineApprovalInput);
const approvalEvaluation = (result: ReturnType<typeof evaluateMilestone>) => result.requirementEvaluations.find((item) => item.requirementId === "req:approval");
const approvalOnlyInput = (overrides: Partial<MilestoneEvaluationInput> = {}): MilestoneEvaluationInput => approvalInput({
  milestone: { ...milestone, requirementIds: ["req:approval"] },
  requirements: baseRequirements.filter((item) => item.id === "req:approval"),
  observations: { "req:approval": { evidenceReferences: ["approval:exact"] } },
  evidenceItems: [],
  evidenceMatches: [],
  ...overrides,
});

describe("milestone engine", () => {
  it("returns deterministic, stable requirement ordering and structured outcomes", () => {
    const input = approvalInput({
      requirements: [...baseRequirements].reverse(),
    });
    input.approvalRecord = exactApprovalFor(input);
    const first = evaluateMilestone(input);
    const second = evaluateMilestone(input);
    expect(first).toEqual(second);
    expect(first.requirementEvaluations.map((item) => item.requirementId)).toEqual([...requirementIds].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
    expect(first.status).toBe("ELIGIBLE");
    expect(first.humanApprovalRequired).toBe(false);
    expect(first.erc8183ActionPermitted).toBe(false);
    expect(first.recommendedNextAction).toBe("PREPARE_JOB_DRAFT");
  });

  it("is deterministic with non-ASCII and tie-style IDs using locale-independent ordering", () => {
    const customMilestone = {
      ...milestone,
      requirementIds: ["req:a", "req:a-1", "req:ä"],
    };
    const customRequirements: MilestoneRequirement[] = [
      { id: "req:ä", milestoneId: customMilestone.id, kind: "TRANSACTION_MATCH", description: "match" },
      { id: "req:a-1", milestoneId: customMilestone.id, kind: "HUMAN_APPROVAL", description: "approval" },
      { id: "req:a", milestoneId: customMilestone.id, kind: "DELIVERABLE", description: "deliverable" },
    ];
    const input = approvalInput({
      milestone: customMilestone,
      requirements: customRequirements,
      observations: {
        "req:ä": { evidenceReferences: ["evidence:tx"], transactionMatched: true },
        "req:a-1": { evidenceReferences: ["approval:exact"] },
        "req:a": { evidenceReferences: ["evidence:deliverable"], deliverableCount: 1 },
      },
      evidenceItems: [
        EvidenceItemSchema.parse({ id: "evidence:tx", projectId: milestone.projectId, kind: "STATEMENT", sourceHash: `sha256:${"8".repeat(64)}`, storageRef: "private://tx", visibility: "FOUNDER_PRIVATE", submittedAt: evaluatedAt }),
        EvidenceItemSchema.parse({ id: "evidence:deliverable", projectId: milestone.projectId, kind: "DELIVERABLE", sourceHash: `sha256:${"9".repeat(64)}`, storageRef: "private://deliverable-a", visibility: "FOUNDER_PRIVATE", submittedAt: evaluatedAt }),
      ],
      evidenceMatches: [
        EvidenceMatchSchema.parse({ id: "match:tx:ä", source: "HUMAN_DECISION", evidenceId: "evidence:tx", requirementId: "req:ä", confidenceBasisPoints: null, explanation: "accepted", acceptedBy: { actorType: "EVALUATOR", actorId: authorizedEvaluatorId } }),
        EvidenceMatchSchema.parse({ id: "match:deliverable:a", source: "HUMAN_DECISION", evidenceId: "evidence:deliverable", requirementId: "req:a", confidenceBasisPoints: null, explanation: "accepted", acceptedBy: { actorType: "EVALUATOR", actorId: authorizedEvaluatorId } }),
      ],
      verifiedSpend: usdc("1"),
    });
    input.approvalRecord = exactApprovalFor(input);
    const result = evaluateMilestone(input);
    expect(result.requirementEvaluations.map((item) => item.requirementId)).toEqual(["req:a", "req:a-1", "req:ä"]);
  });

  it("fails closed when supplied requirements are missing, extra, duplicate, or foreign", () => {
    expect(() => evaluateMilestone({
      milestone,
      requirements: baseRequirements.slice(0, -1),
      observations: baseObservations(),
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
    })).toThrow(/exactly match/i);

    expect(() => evaluateMilestone({
      milestone,
      requirements: [...baseRequirements, { ...baseRequirements[0], id: "req:extra" }],
      observations: baseObservations(),
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
    })).toThrow(/exactly match/i);

    expect(() => evaluateMilestone({
      milestone,
      requirements: [...baseRequirements, baseRequirements[0]],
      observations: baseObservations(),
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
    })).toThrow(/unique/i);

    expect(() => evaluateMilestone({
      milestone,
      requirements: baseRequirements.map((requirement, index) => (index === 0 ? { ...requirement, milestoneId: "milestone:other" } : requirement)),
      observations: baseObservations(),
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
    })).toThrow(/belong to the evaluated milestone/i);
  });

  it("keeps ELIGIBLE while approval is pending and blocks later ERC action", () => {
    const input = approvalInput({
      verifiedSpend: usdc("149999999"),
    });
    const result = evaluateMilestone({
      ...input,
      observations: { ...input.observations, "req:approval": { evidenceReferences: ["approval:pending"] } },
      approvalRecord: ApprovalRecordSchema.parse({
        ...exactApprovalFor(input),
        id: "approval:pending",
        decision: "PENDING",
        approver: null,
        decidedAt: null,
      }),
    });

    expect(result.status).toBe("ELIGIBLE");
    expect(result.humanApprovalRequired).toBe(true);
    expect(result.erc8183ActionPermitted).toBe(false);
    expect(result.recommendedNextAction).toBe("REQUEST_HUMAN_APPROVAL");
  });

  it("requires global exact approval even when HUMAN_APPROVAL requirement is omitted", () => {
    const noApprovalRequirementMilestone = {
      ...milestone,
      requirementIds: requirementIds.filter((item) => item !== "req:approval"),
    };
    const noApprovalRequirements = baseRequirements.filter((item) => item.kind !== "HUMAN_APPROVAL");
    const result = evaluateMilestone(approvalInput({
      milestone: noApprovalRequirementMilestone,
      requirements: noApprovalRequirements,
      verifiedSpend: usdc("149999999"),
      approvalRecord: null,
    }));
    expect(result.status).toBe("ELIGIBLE");
    expect(result.humanApprovalRequired).toBe(true);
    expect(result.erc8183ActionPermitted).toBe(false);
  });

  it("requires exact evaluator and exact intent binding for action permission", () => {
    const base = approvalOnlyInput();
    const baseApproval = exactApprovalFor(base);
    const wrongEvaluator = evaluateMilestone({
      ...base,
      approvalRecord: baseApproval,
      expectedAuthorizedEvaluatorId: "evaluator:other",
    });
    expect(wrongEvaluator.status).toBe("ELIGIBLE");
    expect(wrongEvaluator.erc8183ActionPermitted).toBe(false);
    expect(approvalEvaluation(wrongEvaluator)?.outcome).toBe("REVIEW");
    expect(approvalEvaluation(wrongEvaluator)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const wrongIntent = evaluateMilestone({
      ...base,
      approvalRecord: baseApproval,
      expectedApprovalIntentId: "intent:other",
    });
    expect(wrongIntent.status).toBe("ELIGIBLE");
    expect(wrongIntent.erc8183ActionPermitted).toBe(false);
    expect(approvalEvaluation(wrongIntent)?.outcome).toBe("REVIEW");
    expect(approvalEvaluation(wrongIntent)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const wrongHash = evaluateMilestone({
      ...base,
      approvalRecord: ApprovalRecordSchema.parse({ ...baseApproval, exactIntentHash: `sha256:${"b".repeat(64)}` }),
    });
    expect(wrongHash.status).toBe("ELIGIBLE");
    expect(wrongHash.erc8183ActionPermitted).toBe(false);
    expect(approvalEvaluation(wrongHash)?.outcome).toBe("REVIEW");
    expect(approvalEvaluation(wrongHash)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);
  });

  it("binds milestone approval to canonical policy-driving payload and authority subject", () => {
    const base = approvalInput();
    const approved = exactApprovalFor(base);
    expect(evaluateMilestone({ ...base, approvalRecord: approved }).humanApprovalRequired).toBe(false);

    const changedRequirement = evaluateMilestone({
      ...base,
      requirements: base.requirements.map((requirement) => requirement.id === "req:purpose" ? { ...requirement, description: "Changed policy definition" } : requirement),
      approvalRecord: approved,
    });
    expect(approvalEvaluation(changedRequirement)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const changedEvidenceBinding = evaluateMilestone({
      ...base,
      evidenceMatches: (base.evidenceMatches ?? []).map((match) => match.id === "match:purpose" ? { ...match, evidenceId: "evidence:tx:match" } : match),
      observations: {
        ...base.observations,
        "req:purpose": { evidenceReferences: ["evidence:tx:match"], businessPurposePresent: true },
      },
      approvalRecord: approved,
    });
    expect(approvalEvaluation(changedEvidenceBinding)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const changedSpend = evaluateMilestone({
      ...base,
      verifiedSpend: usdc("149999999"),
      approvalRecord: approved,
    });
    expect(approvalEvaluation(changedSpend)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const changedPolicy = evaluateMilestone({
      ...base,
      policyVersion: "policy:v2",
      approvalRecord: approved,
    });
    expect(approvalEvaluation(changedPolicy)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const changedMilestone = evaluateMilestone({
      ...base,
      milestone: { ...base.milestone, dueAt: "2026-02-02T00:00:00.000Z" },
      approvalRecord: approved,
    });
    expect(approvalEvaluation(changedMilestone)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const changedEvaluatedAt = evaluateMilestone({
      ...base,
      evaluatedAt: "2026-01-21T00:00:00.000Z",
      approvalRecord: approved,
    });
    expect(approvalEvaluation(changedEvaluatedAt)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const authorityBase = approvalOnlyInput();
    const authorityApproval = exactApprovalFor(authorityBase);
    const changedFounderAuthority = evaluateMilestone({
      ...authorityBase,
      expectedAuthorizedFounderId: "founder:other",
      approvalRecord: authorityApproval,
    });
    expect(approvalEvaluation(changedFounderAuthority)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const changedEvaluatorAuthority = evaluateMilestone({
      ...authorityBase,
      expectedAuthorizedEvaluatorId: "evaluator:other",
      approvalRecord: authorityApproval,
    });
    expect(approvalEvaluation(changedEvaluatorAuthority)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const changedApprovalIntent = evaluateMilestone({
      ...authorityBase,
      expectedApprovalIntentId: "intent:other",
      approvalRecord: authorityApproval,
    });
    expect(approvalEvaluation(changedApprovalIntent)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const changedTransactionMatchedObservation = evaluateMilestone({
      ...base,
      observations: { ...base.observations, "req:tx": { ...(base.observations?.["req:tx"] ?? {}), transactionMatched: false } },
      approvalRecord: approved,
    });
    expect(approvalEvaluation(changedTransactionMatchedObservation)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const changedBusinessPurposeObservation = evaluateMilestone({
      ...base,
      observations: { ...base.observations, "req:purpose": { ...(base.observations?.["req:purpose"] ?? {}), businessPurposePresent: false } },
      approvalRecord: approved,
    });
    expect(approvalEvaluation(changedBusinessPurposeObservation)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const changedFounderConfirmationObservation = evaluateMilestone({
      ...base,
      observations: { ...base.observations, "req:confirmation": { ...(base.observations?.["req:confirmation"] ?? {}), founderConfirmationPresent: false } },
      approvalRecord: approved,
    });
    expect(approvalEvaluation(changedFounderConfirmationObservation)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);
  });

  it("blocks rejected or expired approvals and permits only valid exact current approval", () => {
    const base = approvalInput();
    const approved = exactApprovalFor(base);
    const rejectedApproval = evaluateMilestone({
      ...base,
      approvalRecord: ApprovalRecordSchema.parse({ ...approved, decision: "REJECTED" }),
    });
    expect(rejectedApproval.status).toBe("ELIGIBLE");
    expect(rejectedApproval.erc8183ActionPermitted).toBe(false);
    expect(approvalEvaluation(rejectedApproval)?.outcome).toBe("FAIL");
    expect(approvalEvaluation(rejectedApproval)?.reasonCodes).toEqual(["HUMAN_APPROVAL_REJECTED"]);

    const expiredApproval = evaluateMilestone({
      ...base,
      approvalRecord: ApprovalRecordSchema.parse({ ...approved, expiresAt: "2026-01-10T00:00:00.000Z", decidedAt: "2026-01-09T00:00:00.000Z" }),
    });
    expect(expiredApproval.status).toBe("ELIGIBLE");
    expect(expiredApproval.erc8183ActionPermitted).toBe(false);
    expect(approvalEvaluation(expiredApproval)?.outcome).toBe("REVIEW");
    expect(approvalEvaluation(expiredApproval)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const validApproval = evaluateMilestone({ ...base, approvalRecord: approved });
    expect(validApproval.status).toBe("ELIGIBLE");
    expect(validApproval.erc8183ActionPermitted).toBe(false);
    expect(validApproval.recommendedNextAction).toBe("PREPARE_JOB_DRAFT");
    expect(approvalEvaluation(validApproval)?.outcome).toBe("PASS");
    expect(approvalEvaluation(validApproval)?.reasonCodes).toEqual(["HUMAN_APPROVAL_CONFIRMED"]);
  });

  it("keeps ERC-8183 write permission false even when exact milestone approval is confirmed", () => {
    const input = approvalInput();
    const result = evaluateMilestone({ ...input, approvalRecord: exactApprovalFor(input) });
    expect(result.status).toBe("ELIGIBLE");
    expect(result.humanApprovalRequired).toBe(false);
    expect(result.recommendedNextAction).toBe("PREPARE_JOB_DRAFT");
    expect(result.erc8183ActionPermitted).toBe(false);
  });

  it("handles missing/conflicting evidence and keeps optional failures from blocking eligibility", () => {
    const optionalPurpose = baseRequirements.map((item) => (item.id === "req:purpose" ? { ...item, required: false } : item));
    const result = evaluateMilestone(approvalInput({
      requirements: optionalPurpose,
      observations: {
        ...baseObservations(),
        "req:deliverable": { evidenceReferences: [], deliverableCount: 0 },
        "req:expenses": { evidenceReferences: ["evidence:receipt:1"], receiptCount: 1, hasConflictingEvidence: true },
        "req:purpose": { evidenceReferences: [], businessPurposePresent: false },
      },
      evidenceMatches: baseEvidenceMatches().filter((match) => !["match:receipt:2", "match:deliverable", "match:purpose"].includes(match.id)),
      verifiedSpend: usdc("150000001"),
      approvalRecord: null,
      reviewerNotesByRequirementId: { "req:expenses": "conflicting invoice totals" },
    }));
    expect(result.status).toBe("INCOMPLETE");
    expect(result.reasonCodes).toEqual(expect.arrayContaining(["DELIVERABLE_COUNT_SHORT", "EVIDENCE_CONFLICT", "SPEND_LIMIT_EXCEEDED", "BUSINESS_PURPOSE_MISSING"]));
    expect(result.requirementEvaluations.find((item) => item.requirementId === "req:purpose")?.blocksEligibility).toBe(false);
    expect(result.requirementEvaluations.find((item) => item.requirementId === "req:expenses")?.reviewerNotes).toBe("conflicting invoice totals");
  });

  it("ignores LLM-suggested status fields", () => {
    const injected = approvalInput({
      observations: { ...baseObservations(), "req:deliverable": { evidenceReferences: ["evidence:deliverable"], deliverableCount: 1, llmSuggestedMilestoneStatus: "ELIGIBLE" } },
    });
    const withInjectedField = evaluateMilestone({ ...injected, approvalRecord: exactApprovalFor(injected) });
    expect(withInjectedField.status).toBe("ELIGIBLE");
    expect(withInjectedField.erc8183ActionPermitted).toBe(false);
  });

  it("does not allow naked booleans or AI suggestions to authorize PASS", () => {
    const aiOnly = approvalInput({
      evidenceMatches: [
        ...baseEvidenceMatches().filter((match) => ["match:deliverable", "match:receipt:1", "match:receipt:2"].includes(match.id)),
        EvidenceMatchSchema.parse({ id: "match:tx:ai", source: "AI_SUGGESTION", evidenceId: "evidence:tx:match", requirementId: "req:tx", confidenceBasisPoints: 9500, explanation: "ai suggests", acceptedBy: null }),
        EvidenceMatchSchema.parse({ id: "match:confirm:ai", source: "AI_SUGGESTION", evidenceId: "evidence:confirmation", requirementId: "req:confirmation", confidenceBasisPoints: 9500, explanation: "ai suggests", acceptedBy: null }),
      ],
      observations: {
        ...baseObservations(),
        "req:tx": { evidenceReferences: ["evidence:tx:match"], transactionMatched: true },
        "req:confirmation": { evidenceReferences: ["evidence:confirmation"], founderConfirmationPresent: true },
      },
    });
    const aiOnlyResult = evaluateMilestone({ ...aiOnly, approvalRecord: null });
    expect(aiOnlyResult.requirementEvaluations.find((item) => item.requirementId === "req:tx")?.outcome).toBe("REVIEW");
    expect(aiOnlyResult.requirementEvaluations.find((item) => item.requirementId === "req:confirmation")?.outcome).toBe("REVIEW");

    const noAuthorizedConfirmation = approvalInput({
      evidenceMatches: baseEvidenceMatches().map((match) =>
        match.id === "match:confirmation"
          ? EvidenceMatchSchema.parse({ ...match, acceptedBy: { actorType: "FOUNDER", actorId: "founder:other" } })
          : match),
    });
    const noAuthorizedConfirmationResult = evaluateMilestone({ ...noAuthorizedConfirmation, approvalRecord: null });
    expect(noAuthorizedConfirmationResult.requirementEvaluations.find((item) => item.requirementId === "req:confirmation")?.outcome).not.toBe("PASS");
  });

  it("derives pending receipt review only from validated AI provenance", () => {
    const oneAcceptedReceipt = baseEvidenceMatches().filter((match) => match.id !== "match:receipt:2");
    const forgedFlagInput = approvalInput({
      observations: {
        ...baseObservations(),
        "req:expenses": {
          evidenceReferences: ["evidence:receipt:1"],
          receiptCount: 1,
          pendingEvidenceReview: true,
        },
      },
      evidenceMatches: oneAcceptedReceipt,
    });
    const forgedFlagResult = evaluateMilestone({ ...forgedFlagInput, approvalRecord: null });

    expect(forgedFlagResult.status).toBe("INCOMPLETE");
    expect(forgedFlagResult.recommendedNextAction).toBe("PROVIDE_EVIDENCE");
    expect(forgedFlagResult.requirementEvaluations.find((item) => item.requirementId === "req:expenses")).toMatchObject({
      outcome: "FAIL",
      reasonCodes: ["RECEIPT_COUNT_SHORT"],
    });

    const aiSuggestedReceipt = EvidenceMatchSchema.parse({
      id: "match:receipt:2:ai",
      source: "AI_SUGGESTION",
      evidenceId: "evidence:receipt:2",
      requirementId: "req:expenses",
      confidenceBasisPoints: 9200,
      explanation: "AI suggests the second uploaded receipt for review.",
      acceptedBy: null,
    });
    const corroboratedInput = approvalInput({
      observations: {
        ...baseObservations(),
        "req:expenses": { evidenceReferences: ["evidence:receipt:1"], receiptCount: 1 },
      },
      evidenceMatches: [...oneAcceptedReceipt, aiSuggestedReceipt],
    });
    const corroboratedResult = evaluateMilestone({ ...corroboratedInput, approvalRecord: null });

    expect(corroboratedResult.status).toBe("NEEDS_REVIEW");
    expect(corroboratedResult.recommendedNextAction).toBe("REQUEST_HUMAN_REVIEW");
    expect(corroboratedResult.requirementEvaluations.find((item) => item.requirementId === "req:expenses")).toMatchObject({
      outcome: "REVIEW",
      reasonCodes: ["EVIDENCE_MISSING"],
    });
  });

  it("rejects future-dated AI evidence before deriving pending review provenance", () => {
    const oneAcceptedReceipt = baseEvidenceMatches().filter((match) => match.id !== "match:receipt:2");
    const aiSuggestedReceipt = EvidenceMatchSchema.parse({
      id: "match:receipt:2:ai:future",
      source: "AI_SUGGESTION",
      evidenceId: "evidence:receipt:2",
      requirementId: "req:expenses",
      confidenceBasisPoints: 9200,
      explanation: "AI suggests a future-dated receipt for review.",
      acceptedBy: null,
    });
    const futureEvidenceItems = baseEvidenceItems().map((item) =>
      item.id === "evidence:receipt:2"
        ? EvidenceItemSchema.parse({ ...item, submittedAt: "2026-01-20T00:00:01.000Z" })
        : item
    );

    expect(() => evaluateMilestone(approvalInput({
      evidenceItems: futureEvidenceItems,
      evidenceMatches: [...oneAcceptedReceipt, aiSuggestedReceipt],
      observations: {
        ...baseObservations(),
        "req:expenses": { evidenceReferences: ["evidence:receipt:1"], receiptCount: 1 },
      },
      approvalRecord: null,
    }))).toThrow(/evidence submitted after the evaluation timestamp/i);
  });

  it("requires authorized evaluator/founder identities for accepted HUMAN_DECISION provenance", () => {
    const unauthorizedDeliverableAndReceipt = approvalInput({
      evidenceMatches: baseEvidenceMatches().map((match) => (
        match.requirementId === "req:deliverable" || match.requirementId === "req:expenses"
          ? EvidenceMatchSchema.parse({
            ...match,
            acceptedBy: { actorType: "EVALUATOR", actorId: "evaluator:other" },
          })
          : match
      )),
    });
    expect(() => evaluateMilestone({ ...unauthorizedDeliverableAndReceipt, approvalRecord: null })).toThrow(/resolve to accepted evidence records/i);

    const unauthorizedNonCount = approvalInput({
      evidenceMatches: baseEvidenceMatches().map((match) => (
        match.requirementId === "req:tx" || match.requirementId === "req:purpose"
          ? EvidenceMatchSchema.parse({
            ...match,
            acceptedBy: { actorType: "EVALUATOR", actorId: "evaluator:other" },
          })
          : match
      )),
    });
    const unauthorizedNonCountResult = evaluateMilestone({ ...unauthorizedNonCount, approvalRecord: null });
    expect(unauthorizedNonCountResult.requirementEvaluations.find((item) => item.requirementId === "req:tx")?.outcome).not.toBe("PASS");
    expect(unauthorizedNonCountResult.requirementEvaluations.find((item) => item.requirementId === "req:purpose")?.outcome).not.toBe("PASS");
  });

  it("fails closed for count-based requirements unless references exactly bind accepted evidence", () => {
    expect(() => evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:expenses": { evidenceReferences: [], receiptCount: 1 },
      },
      approvalRecord: exactApproval,
    }))).toThrow(/receiptCount must match/i);

    expect(() => evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:expenses": { evidenceReferences: ["evidence:receipt:1", "evidence:receipt:1"], receiptCount: 2 },
      },
      approvalRecord: exactApproval,
    }))).toThrow(/must be unique/i);

    expect(() => evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:deliverable": { evidenceReferences: ["evidence:deliverable"], deliverableCount: 2 },
      },
      approvalRecord: exactApproval,
    }))).toThrow(/deliverableCount must match/i);

    expect(() => evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:expenses": { evidenceReferences: ["evidence:invented:1", "evidence:invented:2"], receiptCount: 2 },
      },
      approvalRecord: exactApproval,
    }))).toThrow(/resolve to accepted evidence records/i);

    expect(() => evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:expenses": { evidenceReferences: ["evidence:receipt:1", "evidence:tx:match"], receiptCount: 2 },
      },
      approvalRecord: exactApproval,
    }))).toThrow(/resolve to accepted evidence records/i);

    const wrongKind = approvalInput({
      evidenceItems: baseEvidenceItems().map((item) => item.id === "evidence:receipt:2" ? EvidenceItemSchema.parse({ ...item, kind: "INVOICE" }) : item),
    });
    expect(() => evaluateMilestone({ ...wrongKind, approvalRecord: null })).toThrow(/resolve to accepted evidence records/i);

    expect(() => evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:expenses": { evidenceReferences: ["evidence:receipt:1", `sha256:${"2".repeat(64)}`], receiptCount: 2 },
      },
      approvalRecord: exactApproval,
    }))).toThrow(/cannot alias the same accepted evidence record/i);

    const resultInput = approvalInput({
      observations: {
        ...baseObservations(),
        "req:expenses": { evidenceReferences: ["evidence:receipt:1", `sha256:${"3".repeat(64)}`], receiptCount: 2 },
        "req:deliverable": { evidenceReferences: [`sha256:${"1".repeat(64)}`], deliverableCount: 1 },
      },
    });
    const result = evaluateMilestone({ ...resultInput, approvalRecord: exactApprovalFor(resultInput) });
    expect(result.requirementEvaluations.find((item) => item.requirementId === "req:expenses")?.reasonCodes).toEqual(["RECEIPT_COUNT_MET"]);
    expect(result.requirementEvaluations.find((item) => item.requirementId === "req:deliverable")?.reasonCodes).toEqual(["DELIVERABLE_COUNT_MET"]);
  });

  it("fails closed for non-count requirements unless references exactly bind accepted evidence", () => {
    expect(() => evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:tx": { evidenceReferences: ["evidence:invented"], transactionMatched: true },
      },
      approvalRecord: exactApproval,
    }))).toThrow(/Non-count evidence references must resolve to accepted evidence records/i);

    expect(() => evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:purpose": { evidenceReferences: ["evidence:tx:match"], businessPurposePresent: true },
      },
      approvalRecord: exactApproval,
    }))).toThrow(/Non-count evidence references must resolve to accepted evidence records/i);

    expect(() => evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:tx": { evidenceReferences: ["evidence:tx:match", `sha256:${"5".repeat(64)}`], transactionMatched: true },
      },
      approvalRecord: exactApproval,
    }))).toThrow(/Non-count evidence references cannot alias the same accepted evidence record/i);

    const valid = approvalInput({
      observations: {
        ...baseObservations(),
        "req:tx": { evidenceReferences: [`sha256:${"5".repeat(64)}`], transactionMatched: true },
        "req:purpose": { evidenceReferences: ["evidence:purpose"], businessPurposePresent: true },
      },
    });
    const result = evaluateMilestone({ ...valid, approvalRecord: exactApprovalFor(valid) });
    expect(result.requirementEvaluations.find((item) => item.requirementId === "req:tx")?.reasonCodes).toEqual(["TRANSACTION_MATCHED"]);
    expect(result.requirementEvaluations.find((item) => item.requirementId === "req:purpose")?.reasonCodes).toEqual(["BUSINESS_PURPOSE_PRESENT"]);
  });

  it("binds founder confirmation references to the exact accepted confirmation evidence set", () => {
    expect(() => evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:confirmation": { evidenceReferences: ["evidence:invented"], founderConfirmationPresent: true },
      },
      approvalRecord: exactApproval,
    }))).toThrow(/Confirmation evidence references must resolve to accepted evidence records/i);

    const idReferenceResult = evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:confirmation": { evidenceReferences: ["evidence:confirmation"], founderConfirmationPresent: true },
      },
      approvalRecord: exactApproval,
    }));
    expect(idReferenceResult.requirementEvaluations.find((item) => item.requirementId === "req:confirmation")?.reasonCodes).toEqual(["CONFIRMATION_PRESENT"]);

    const hashReferenceResult = evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:confirmation": { evidenceReferences: [`sha256:${"4".repeat(64)}`], founderConfirmationPresent: true },
      },
      approvalRecord: exactApproval,
    }));
    expect(hashReferenceResult.requirementEvaluations.find((item) => item.requirementId === "req:confirmation")?.reasonCodes).toEqual(["CONFIRMATION_PRESENT"]);
  });

  it("binds HUMAN_APPROVAL references to the real approval record id", () => {
    const confirmed = evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:approval": { evidenceReferences: ["approval:exact"] },
      },
      approvalRecord: exactApproval,
    }));
    expect(approvalEvaluation(confirmed)?.evidenceReferences).toEqual(["approval:exact"]);
    expect(approvalEvaluation(confirmed)?.reasonCodes).toEqual(["HUMAN_APPROVAL_CONFIRMED"]);

    const rejectedApproval = ApprovalRecordSchema.parse({ ...exactApproval, decision: "REJECTED" });
    const rejected = evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:approval": { evidenceReferences: ["approval:exact"] },
      },
      approvalRecord: rejectedApproval,
    }));
    expect(approvalEvaluation(rejected)?.evidenceReferences).toEqual(["approval:exact"]);
    expect(approvalEvaluation(rejected)?.reasonCodes).toEqual(["HUMAN_APPROVAL_REJECTED"]);

    expect(() => evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:approval": { evidenceReferences: ["approval:fake"] },
      },
      approvalRecord: exactApproval,
    }))).toThrow(/Human approval evidence references must exactly match the approval record id/i);

    const pendingWithoutRecord = evaluateMilestone(approvalInput({
      observations: {
        ...baseObservations(),
        "req:approval": { evidenceReferences: ["approval:fake"] },
      },
      approvalRecord: null,
    }));
    expect(approvalEvaluation(pendingWithoutRecord)?.evidenceReferences).toEqual([]);
    expect(approvalEvaluation(pendingWithoutRecord)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);
  });

  it("enforces agentic job draft budget and expiry boundaries", () => {
    const input = {
      clientAddressReference: "client:1",
      providerAddressReference: "provider:1",
      evaluatorAddressReference: "evaluator:1",
      expiry: "2026-01-21T00:00:00.000Z",
      descriptionReference: "description:launch",
      budget: usdc("150000000"),
      approvedTrancheCeiling: usdc("150000000"),
      hookAddressReference: null,
      deliverableHashPlaceholder: `sha256:${"d".repeat(64)}`,
      evaluationReasonHashPlaceholder: `sha256:${"e".repeat(64)}`,
      milestoneId: milestone.id,
      policyVersion,
      evaluationReference: evaluatedAt,
      referenceTime: evaluatedAt,
    };
    expect(createAgenticJobDraft(input).budget.atomicUnits).toBe("150000000");
    expect(() => createAgenticJobDraft({ ...input, budget: usdc("150000001") })).toThrow(/tranche ceiling/i);
    expect(() => createAgenticJobDraft({ ...input, budget: usdc("0") })).toThrow(/greater than zero/i);
    expect(() => createAgenticJobDraft({ ...input, expiry: evaluatedAt })).toThrow(/future/i);
  });

  it("has exhaustive allowed/disallowed ERC-8183 transitions", () => {
    const allowed: Record<AgenticJobStatus, AgenticJobStatus[]> = {
      OPEN: ["FUNDED", "REJECTED"],
      FUNDED: ["SUBMITTED", "REJECTED", "EXPIRED"],
      SUBMITTED: ["COMPLETED", "REJECTED", "EXPIRED"],
      COMPLETED: [],
      REJECTED: [],
      EXPIRED: [],
    };
    for (const from of AgenticJobStatusSchema.options) {
      for (const to of AgenticJobStatusSchema.options) {
        const permitted = allowed[from].includes(to);
        expect(isAllowedErc8183Transition(from, to)).toBe(permitted);
        if (permitted) expect(() => assertErc8183Transition(from, to)).not.toThrow();
        else expect(() => assertErc8183Transition(from, to)).toThrow();
      }
    }
    expect(isAllowedErc8183Transition("OPEN", "COMPLETED")).toBe(false);
    expect(isAllowedErc8183Transition("FUNDED", "OPEN")).toBe(false);
    expect(isAllowedErc8183Transition("FUNDED", "FUNDED")).toBe(false);
  });

  it("rejects raw private evidence content in references while accepting ID/hash references", () => {
    expect(() => evaluateMilestone(approvalInput({
      observations: { ...baseObservations(), "req:tx": { evidenceReferences: ["founder private receipt text"], transactionMatched: true } },
      approvalRecord: exactApproval,
    }))).toThrow();

    const input = approvalInput({
      observations: {
        ...baseObservations(),
        "req:tx": { evidenceReferences: [`sha256:${"5".repeat(64)}`], transactionMatched: true },
      },
    });
    const result = evaluateMilestone({ ...input, approvalRecord: exactApprovalFor(input) });
    expect(result.status).toBe("ELIGIBLE");
  });

  it("does not emit private passthrough fields and keeps release confirmation gated by settlement reference", () => {
    const input = approvalInput({
      observations: { ...baseObservations(), "req:deliverable": { evidenceReferences: ["evidence:deliverable"], deliverableCount: 1, rawPrivateEvidence: "founder-private-receipt-content" } },
    });
    const result = evaluateMilestone({ ...input, approvalRecord: exactApprovalFor(input) });
    expect(JSON.stringify(result)).not.toContain("founder-private-receipt-content");
    expect(() => ReleaseRequestSchema.parse({
      id: "release:1",
      projectId: milestone.projectId,
      milestoneId: milestone.id,
      proofId: "proof:1",
      intentId: "intent:1",
      settlementId: null,
      amount: usdc("1"),
      state: "CONFIRMED",
      approvalId: "approval:1",
      idempotencyKey: "release:key:1",
      createdAt: evaluatedAt,
    })).toThrow();
  });
});
