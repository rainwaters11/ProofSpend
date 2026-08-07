import { describe, expect, it } from "vitest";
import {
  AgenticJobStatusSchema,
  ApprovalRecordSchema,
  ReleaseRequestSchema,
  SettlementMoneyAmountSchema,
  assertErc8183Transition,
  createAgenticJobDraft,
  evaluateMilestone,
  isAllowedErc8183Transition,
  type AgenticJobStatus,
  type MilestoneRequirement,
} from "../src";

const usdc = (atomicUnits: string) => SettlementMoneyAmountSchema.parse({ asset: "USDC", atomicUnits });
const milestone = {
  id: "milestone:launch",
  projectId: "project:launch",
  title: "Launch tranche",
  proposedAmount: usdc("150000000"),
  status: "INCOMPLETE" as const,
  requirementIds: [],
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

function baseObservations() {
  return {
    "req:deliverable": { evidenceReferences: ["evidence:deliverable"], deliverableCount: 1 },
    "req:expenses": { evidenceReferences: ["evidence:receipt:1", "evidence:receipt:2"], receiptCount: 2 },
    "req:confirmation": { evidenceReferences: ["evidence:confirmation"], founderConfirmationPresent: true },
    "req:tx": { evidenceReferences: ["evidence:tx:match"], transactionMatched: true },
    "req:purpose": { evidenceReferences: ["evidence:purpose"], businessPurposePresent: true },
    "req:due": { evidenceReferences: ["evidence:due"] },
    "req:approval": { evidenceReferences: ["approval:record"] },
  };
}

describe("milestone engine", () => {
  it("returns deterministic, stable requirement ordering and structured outcomes", () => {
    const input = {
      milestone,
      requirements: [...baseRequirements].reverse(),
      observations: baseObservations(),
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: ApprovalRecordSchema.parse({
        id: "approval:1",
        aggregateId: milestone.id,
        intentId: "intent:1",
        actionKind: "MILESTONE_EVALUATION",
        authorizedActorType: "EVALUATOR",
        authorizedActorId: "evaluator:1",
        exactIntentHash: `sha256:${"a".repeat(64)}`,
        idempotencyKey: "approval:key:1",
        decision: "APPROVED",
        approver: { actorId: "evaluator:1", actorType: "EVALUATOR" },
        expiresAt: "2026-01-30T00:00:00.000Z",
        decidedAt: "2026-01-19T00:00:00.000Z",
      }),
    };
    const first = evaluateMilestone(input);
    const second = evaluateMilestone(input);
    expect(first).toEqual(second);
    expect(first.requirementEvaluations.map((item) => item.requirementId)).toEqual([...baseRequirements].map((item) => item.id).sort());
    expect(first.status).toBe("ELIGIBLE");
    expect(first.humanApprovalRequired).toBe(false);
    expect(first.erc8183ActionPermitted).toBe(true);
  });

  it("keeps ELIGIBLE while approval is pending and blocks later ERC action", () => {
    const result = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: baseObservations(),
      verifiedSpend: usdc("149999999"),
      evaluatedAt,
      policyVersion,
      approvalRecord: ApprovalRecordSchema.parse({
        id: "approval:pending",
        aggregateId: milestone.id,
        intentId: "intent:pending",
        actionKind: "MILESTONE_EVALUATION",
        authorizedActorType: "EVALUATOR",
        authorizedActorId: "evaluator:1",
        exactIntentHash: `sha256:${"b".repeat(64)}`,
        idempotencyKey: "approval:key:pending",
        decision: "PENDING",
        approver: null,
        expiresAt: "2026-01-30T00:00:00.000Z",
        decidedAt: null,
      }),
    });

    expect(result.status).toBe("ELIGIBLE");
    expect(result.humanApprovalRequired).toBe(true);
    expect(result.erc8183ActionPermitted).toBe(false);
    expect(result.recommendedNextAction).toBe("REQUEST_HUMAN_APPROVAL");
  });

  it("does not require human approval when requirement is omitted", () => {
    const result = evaluateMilestone({
      milestone,
      requirements: baseRequirements.filter((item) => item.kind !== "HUMAN_APPROVAL"),
      observations: baseObservations(),
      verifiedSpend: usdc("149999999"),
      evaluatedAt,
      policyVersion,
      approvalRecord: null,
    });
    expect(result.status).toBe("ELIGIBLE");
    expect(result.humanApprovalRequired).toBe(false);
    expect(result.erc8183ActionPermitted).toBe(true);
  });

  it("handles missing/conflicting evidence and keeps optional failures from blocking eligibility", () => {
    const optionalPurpose = baseRequirements.map((item) => (item.id === "req:purpose" ? { ...item, required: false } : item));
    const result = evaluateMilestone({
      milestone,
      requirements: optionalPurpose,
      observations: {
        ...baseObservations(),
        "req:deliverable": { evidenceReferences: [], deliverableCount: 0 },
        "req:expenses": { evidenceReferences: ["evidence:receipt:1"], receiptCount: 1, hasConflictingEvidence: true },
        "req:purpose": { evidenceReferences: [], businessPurposePresent: false },
      },
      verifiedSpend: usdc("150000001"),
      evaluatedAt,
      policyVersion,
      approvalRecord: null,
      reviewerNotesByRequirementId: { "req:expenses": "conflicting invoice totals" },
    });
    expect(result.status).toBe("INCOMPLETE");
    expect(result.reasonCodes).toEqual(expect.arrayContaining(["DELIVERABLE_COUNT_SHORT", "EVIDENCE_CONFLICT", "SPEND_LIMIT_EXCEEDED", "BUSINESS_PURPOSE_MISSING"]));
    expect(result.requirementEvaluations.find((item) => item.requirementId === "req:purpose")?.blocksEligibility).toBe(false);
    expect(result.requirementEvaluations.find((item) => item.requirementId === "req:expenses")?.reviewerNotes).toBe("conflicting invoice totals");
  });

  it("handles rejected/expired approvals and ignores LLM-suggested status fields", () => {
    const withInjectedField = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: { ...baseObservations(), "req:deliverable": { evidenceReferences: ["evidence:deliverable"], deliverableCount: 1, llmSuggestedMilestoneStatus: "ELIGIBLE" } },
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: ApprovalRecordSchema.parse({
        id: "approval:rejected",
        aggregateId: milestone.id,
        intentId: "intent:rejected",
        actionKind: "MILESTONE_EVALUATION",
        authorizedActorType: "EVALUATOR",
        authorizedActorId: "evaluator:1",
        exactIntentHash: `sha256:${"c".repeat(64)}`,
        idempotencyKey: "approval:key:rejected",
        decision: "REJECTED",
        approver: { actorId: "evaluator:1", actorType: "EVALUATOR" },
        expiresAt: "2026-01-30T00:00:00.000Z",
        decidedAt: "2026-01-19T00:00:00.000Z",
      }),
    });
    expect(withInjectedField.status).toBe("ELIGIBLE");
    const approvalEvaluation = withInjectedField.requirementEvaluations.find((item) => item.requirementId === "req:approval");
    expect(approvalEvaluation?.outcome).toBe("FAIL");
    expect(approvalEvaluation?.reasonCodes).toEqual(["HUMAN_APPROVAL_REJECTED"]);
    expect(withInjectedField.erc8183ActionPermitted).toBe(false);
    expect(withInjectedField.recommendedNextAction).toBe("REQUEST_HUMAN_APPROVAL");
    const expiredApproval = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: baseObservations(),
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: ApprovalRecordSchema.parse({
        id: "approval:expired",
        aggregateId: milestone.id,
        intentId: "intent:expired",
        actionKind: "MILESTONE_EVALUATION",
        authorizedActorType: "EVALUATOR",
        authorizedActorId: "evaluator:1",
        exactIntentHash: `sha256:${"f".repeat(64)}`,
        idempotencyKey: "approval:key:expired",
        decision: "APPROVED",
        approver: { actorId: "evaluator:1", actorType: "EVALUATOR" },
        expiresAt: "2026-01-10T00:00:00.000Z",
        decidedAt: "2026-01-09T00:00:00.000Z",
      }),
    });
    expect(expiredApproval.requirementEvaluations.find((item) => item.requirementId === "req:approval")?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);
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
      OPEN: ["FUNDED"],
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

  it("does not emit private evidence content and keeps release confirmation gated by settlement reference", () => {
    const result = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: { ...baseObservations(), "req:deliverable": { evidenceReferences: ["evidence:deliverable-id"], deliverableCount: 1, rawPrivateEvidence: "founder-private-receipt-content" } },
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: null,
    });
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
