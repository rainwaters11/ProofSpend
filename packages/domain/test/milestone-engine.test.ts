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
const approvalIntentHash = `sha256:${"a".repeat(64)}`;
const authorizedEvaluatorId = "evaluator:1";

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

const exactApproval = ApprovalRecordSchema.parse({
  id: "approval:exact",
  aggregateId: milestone.id,
  intentId: approvalIntentId,
  actionKind: "MILESTONE_EVALUATION",
  authorizedActorType: "EVALUATOR",
  authorizedActorId: authorizedEvaluatorId,
  exactIntentHash: approvalIntentHash,
  idempotencyKey: "approval:key:exact",
  decision: "APPROVED",
  approver: { actorId: authorizedEvaluatorId, actorType: "EVALUATOR" },
  expiresAt: "2026-01-30T00:00:00.000Z",
  decidedAt: "2026-01-19T00:00:00.000Z",
});
const approvalEvaluation = (result: ReturnType<typeof evaluateMilestone>) => result.requirementEvaluations.find((item) => item.requirementId === "req:approval");

describe("milestone engine", () => {
  it("returns deterministic, stable requirement ordering and structured outcomes", () => {
    const input = {
      milestone,
      requirements: [...baseRequirements].reverse(),
      observations: baseObservations(),
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
    };
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
    const result = evaluateMilestone({
      milestone: customMilestone,
      requirements: customRequirements,
      observations: {
        "req:ä": { evidenceReferences: ["evidence:tx"], transactionMatched: true },
        "req:a-1": { evidenceReferences: ["approval:record"] },
        "req:a": { evidenceReferences: ["evidence:deliverable"], deliverableCount: 1 },
      },
      verifiedSpend: usdc("1"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
    });
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
    const result = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: baseObservations(),
      verifiedSpend: usdc("149999999"),
      evaluatedAt,
      policyVersion,
      approvalRecord: ApprovalRecordSchema.parse({
        ...exactApproval,
        id: "approval:pending",
        decision: "PENDING",
        approver: null,
        decidedAt: null,
      }),
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
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
    const result = evaluateMilestone({
      milestone: noApprovalRequirementMilestone,
      requirements: noApprovalRequirements,
      observations: baseObservations(),
      verifiedSpend: usdc("149999999"),
      evaluatedAt,
      policyVersion,
      approvalRecord: null,
    });
    expect(result.status).toBe("ELIGIBLE");
    expect(result.humanApprovalRequired).toBe(true);
    expect(result.erc8183ActionPermitted).toBe(false);
  });

  it("requires exact evaluator and exact intent binding for action permission", () => {
    const wrongEvaluator = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: baseObservations(),
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: "evaluator:other",
    });
    expect(wrongEvaluator.status).toBe("ELIGIBLE");
    expect(wrongEvaluator.erc8183ActionPermitted).toBe(false);
    expect(approvalEvaluation(wrongEvaluator)?.outcome).toBe("REVIEW");
    expect(approvalEvaluation(wrongEvaluator)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const wrongIntent = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: baseObservations(),
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
      expectedApprovalIntentId: "intent:other",
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
    });
    expect(wrongIntent.status).toBe("ELIGIBLE");
    expect(wrongIntent.erc8183ActionPermitted).toBe(false);
    expect(approvalEvaluation(wrongIntent)?.outcome).toBe("REVIEW");
    expect(approvalEvaluation(wrongIntent)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const wrongHash = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: baseObservations(),
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: `sha256:${"b".repeat(64)}`,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
    });
    expect(wrongHash.status).toBe("ELIGIBLE");
    expect(wrongHash.erc8183ActionPermitted).toBe(false);
    expect(approvalEvaluation(wrongHash)?.outcome).toBe("REVIEW");
    expect(approvalEvaluation(wrongHash)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);
  });

  it("blocks rejected or expired approvals and permits only valid exact current approval", () => {
    const rejectedApproval = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: baseObservations(),
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: ApprovalRecordSchema.parse({ ...exactApproval, decision: "REJECTED" }),
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
    });
    expect(rejectedApproval.status).toBe("ELIGIBLE");
    expect(rejectedApproval.erc8183ActionPermitted).toBe(false);
    expect(approvalEvaluation(rejectedApproval)?.outcome).toBe("FAIL");
    expect(approvalEvaluation(rejectedApproval)?.reasonCodes).toEqual(["HUMAN_APPROVAL_REJECTED"]);

    const expiredApproval = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: baseObservations(),
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: ApprovalRecordSchema.parse({ ...exactApproval, expiresAt: "2026-01-10T00:00:00.000Z", decidedAt: "2026-01-09T00:00:00.000Z" }),
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
    });
    expect(expiredApproval.status).toBe("ELIGIBLE");
    expect(expiredApproval.erc8183ActionPermitted).toBe(false);
    expect(approvalEvaluation(expiredApproval)?.outcome).toBe("REVIEW");
    expect(approvalEvaluation(expiredApproval)?.reasonCodes).toEqual(["HUMAN_APPROVAL_PENDING"]);

    const validApproval = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: baseObservations(),
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
    });
    expect(validApproval.status).toBe("ELIGIBLE");
    expect(validApproval.erc8183ActionPermitted).toBe(false);
    expect(validApproval.recommendedNextAction).toBe("PREPARE_JOB_DRAFT");
    expect(approvalEvaluation(validApproval)?.outcome).toBe("PASS");
    expect(approvalEvaluation(validApproval)?.reasonCodes).toEqual(["HUMAN_APPROVAL_CONFIRMED"]);
  });

  it("keeps ERC-8183 write permission false even when exact milestone approval is confirmed", () => {
    const result = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: baseObservations(),
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
    });
    expect(result.status).toBe("ELIGIBLE");
    expect(result.humanApprovalRequired).toBe(false);
    expect(result.recommendedNextAction).toBe("PREPARE_JOB_DRAFT");
    expect(result.erc8183ActionPermitted).toBe(false);
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

  it("ignores LLM-suggested status fields", () => {
    const withInjectedField = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: { ...baseObservations(), "req:deliverable": { evidenceReferences: ["evidence:deliverable"], deliverableCount: 1, llmSuggestedMilestoneStatus: "ELIGIBLE" } },
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
    });
    expect(withInjectedField.status).toBe("ELIGIBLE");
    expect(withInjectedField.erc8183ActionPermitted).toBe(false);
  });

  it("fails closed for count-based requirements without distinct evidence-reference consistency", () => {
    expect(() => evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: {
        ...baseObservations(),
        "req:expenses": { evidenceReferences: [], receiptCount: 1 },
      },
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
    })).toThrow(/receiptCount must match/i);

    expect(() => evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: {
        ...baseObservations(),
        "req:expenses": { evidenceReferences: ["evidence:receipt:1", "evidence:receipt:1"], receiptCount: 2 },
      },
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
    })).toThrow(/must be unique/i);

    expect(() => evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: {
        ...baseObservations(),
        "req:deliverable": { evidenceReferences: ["evidence:deliverable"], deliverableCount: 2 },
      },
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
    })).toThrow(/deliverableCount must match/i);

    const result = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: {
        ...baseObservations(),
        "req:expenses": { evidenceReferences: ["evidence:receipt:1", "evidence:receipt:2"], receiptCount: 2 },
        "req:deliverable": { evidenceReferences: ["evidence:deliverable"], deliverableCount: 1 },
      },
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
    });
    expect(result.requirementEvaluations.find((item) => item.requirementId === "req:expenses")?.reasonCodes).toEqual(["RECEIPT_COUNT_MET"]);
    expect(result.requirementEvaluations.find((item) => item.requirementId === "req:deliverable")?.reasonCodes).toEqual(["DELIVERABLE_COUNT_MET"]);
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
    expect(() => evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: { ...baseObservations(), "req:deliverable": { evidenceReferences: ["founder private receipt text"], deliverableCount: 1 } },
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
    })).toThrow();

    const result = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: {
        ...baseObservations(),
        "req:deliverable": { evidenceReferences: ["evidence:deliverable-id", `sha256:${"f".repeat(64)}`], deliverableCount: 1 },
      },
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
    });
    expect(result.status).toBe("ELIGIBLE");
  });

  it("does not emit private passthrough fields and keeps release confirmation gated by settlement reference", () => {
    const result = evaluateMilestone({
      milestone,
      requirements: baseRequirements,
      observations: { ...baseObservations(), "req:deliverable": { evidenceReferences: ["evidence:deliverable-id"], deliverableCount: 1, rawPrivateEvidence: "founder-private-receipt-content" } },
      verifiedSpend: usdc("150000000"),
      evaluatedAt,
      policyVersion,
      approvalRecord: exactApproval,
      expectedApprovalIntentId: approvalIntentId,
      expectedApprovalExactIntentHash: approvalIntentHash,
      expectedAuthorizedEvaluatorId: authorizedEvaluatorId,
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
