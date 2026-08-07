import { z } from "zod";
import { ApprovalRecordSchema, AgenticJobStatusSchema, MilestoneRequirementSchema, MilestoneSchema, SettlementMoneyAmountSchema, type AgenticJobStatus, type ApprovalRecord, type MilestoneRequirement } from "./models";
import { AgenticJobTransitionMap, assertAgenticJobTransition, isAllowedAgenticJobTransition } from "./state";

const InternalEvidenceReferenceSchema = z.string().regex(/^[a-z][a-z0-9-]*:[A-Za-z0-9._:-]+$/);
const HashReferenceSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const ReasonReferenceSchema = z.union([InternalEvidenceReferenceSchema, HashReferenceSchema]);
const finiteTime = (value: string): number | null => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const compareAtomicUnits = (left: string, right: string): number => {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  if (leftValue === rightValue) return 0;
  return leftValue > rightValue ? 1 : -1;
};

export const RequirementOutcomeSchema = z.enum(["PASS", "REVIEW", "FAIL"]);
export type RequirementOutcome = z.infer<typeof RequirementOutcomeSchema>;
export const MilestoneEvaluationStatusSchema = z.enum(["INCOMPLETE", "NEEDS_REVIEW", "ELIGIBLE"]);
export type MilestoneEvaluationStatus = z.infer<typeof MilestoneEvaluationStatusSchema>;
export const MilestoneReasonCodeSchema = z.enum([
  "EVIDENCE_MISSING",
  "EVIDENCE_CONFLICT",
  "DELIVERABLE_COUNT_MET",
  "DELIVERABLE_COUNT_SHORT",
  "RECEIPT_COUNT_MET",
  "RECEIPT_COUNT_SHORT",
  "TRANSACTION_MATCHED",
  "TRANSACTION_MISMATCH",
  "BUSINESS_PURPOSE_PRESENT",
  "BUSINESS_PURPOSE_MISSING",
  "SPEND_WITHIN_LIMIT",
  "SPEND_LIMIT_EXCEEDED",
  "CONFIRMATION_PRESENT",
  "CONFIRMATION_MISSING",
  "DUE_DATE_VALID",
  "DUE_DATE_EXPIRED",
  "HUMAN_APPROVAL_PENDING",
  "HUMAN_APPROVAL_REJECTED",
  "HUMAN_APPROVAL_CONFIRMED",
]);
export type MilestoneReasonCode = z.infer<typeof MilestoneReasonCodeSchema>;
export const MilestoneNextActionSchema = z.enum(["PROVIDE_EVIDENCE", "ANSWER_PROOF_RECOVERY", "REQUEST_HUMAN_REVIEW", "REQUEST_HUMAN_APPROVAL", "PREPARE_JOB_DRAFT", "NONE"]);
export type MilestoneNextAction = z.infer<typeof MilestoneNextActionSchema>;

export const RequirementObservationSchema = z.object({
  evidenceReferences: z.array(ReasonReferenceSchema).optional(),
  hasConflictingEvidence: z.boolean().optional(),
  deliverableCount: z.number().int().min(0).optional(),
  receiptCount: z.number().int().min(0).optional(),
  transactionMatched: z.boolean().optional(),
  businessPurposePresent: z.boolean().optional(),
  founderConfirmationPresent: z.boolean().optional(),
}).passthrough();
export type RequirementObservation = z.infer<typeof RequirementObservationSchema>;

export const MilestoneEvaluationInputSchema = z.object({
  milestone: MilestoneSchema,
  requirements: z.array(MilestoneRequirementSchema),
  observations: z.record(z.string(), RequirementObservationSchema).optional(),
  verifiedSpend: SettlementMoneyAmountSchema.optional(),
  policyVersion: z.string().min(1),
  evaluatedAt: z.string().datetime(),
  approvalRecord: ApprovalRecordSchema.nullable().optional(),
  expectedApprovalIntentId: z.string().min(1).optional(),
  expectedApprovalExactIntentHash: HashReferenceSchema.optional(),
  expectedAuthorizedEvaluatorId: z.string().min(1).optional(),
  reviewerNotesByRequirementId: z.record(z.string(), z.string().min(1)).optional(),
});
export type MilestoneEvaluationInput = z.infer<typeof MilestoneEvaluationInputSchema>;

export const RequirementEvaluationSchema = z.object({
  requirementId: z.string().min(1),
  required: z.boolean(),
  evidenceReferences: z.array(ReasonReferenceSchema),
  outcome: RequirementOutcomeSchema,
  reasonCodes: z.array(MilestoneReasonCodeSchema).min(1),
  reviewerNotes: z.string().min(1).nullable(),
  evaluatedAt: z.string().datetime(),
  blocksEligibility: z.boolean(),
  blocksRelease: z.boolean(),
});
export type RequirementEvaluation = z.infer<typeof RequirementEvaluationSchema>;

export const MilestoneEvaluationResultSchema = z.object({
  status: MilestoneEvaluationStatusSchema,
  requirementEvaluations: z.array(RequirementEvaluationSchema),
  reasonCodes: z.array(MilestoneReasonCodeSchema),
  recommendedNextAction: MilestoneNextActionSchema,
  policyVersion: z.string().min(1),
  evaluationTimestamp: z.string().datetime(),
  humanApprovalRequired: z.boolean(),
  erc8183ActionPermitted: z.boolean(),
});
export type MilestoneEvaluationResult = z.infer<typeof MilestoneEvaluationResultSchema>;

type RequirementEvaluationComputation = { outcome: RequirementOutcome; reasonCode: MilestoneReasonCode };
const evaluateByKind = (
  requirement: MilestoneRequirement,
  observation: RequirementObservation,
  input: MilestoneEvaluationInput,
): RequirementEvaluationComputation => {
  if (requirement.kind !== "HUMAN_APPROVAL" && observation.hasConflictingEvidence === true) return { outcome: "REVIEW", reasonCode: "EVIDENCE_CONFLICT" };
  switch (requirement.kind) {
    case "DELIVERABLE": {
      const deliverableCount = observation.deliverableCount ?? observation.evidenceReferences?.length ?? 0;
      return deliverableCount > 0 ? { outcome: "PASS", reasonCode: "DELIVERABLE_COUNT_MET" } : { outcome: "FAIL", reasonCode: "DELIVERABLE_COUNT_SHORT" };
    }
    case "EXPENSE_RECORDS": {
      const receiptCount = observation.receiptCount ?? observation.evidenceReferences?.length ?? 0;
      return receiptCount >= requirement.requiredCount ? { outcome: "PASS", reasonCode: "RECEIPT_COUNT_MET" } : { outcome: "FAIL", reasonCode: "RECEIPT_COUNT_SHORT" };
    }
    case "SPEND_LIMIT": {
      if (input.verifiedSpend === undefined) return { outcome: "FAIL", reasonCode: "EVIDENCE_MISSING" };
      return compareAtomicUnits(input.verifiedSpend.atomicUnits, requirement.spendLimit.atomicUnits) <= 0
        ? { outcome: "PASS", reasonCode: "SPEND_WITHIN_LIMIT" }
        : { outcome: "FAIL", reasonCode: "SPEND_LIMIT_EXCEEDED" };
    }
    case "FOUNDER_CONFIRMATION":
      if (observation.founderConfirmationPresent === true) return { outcome: "PASS", reasonCode: "CONFIRMATION_PRESENT" };
      return { outcome: "FAIL", reasonCode: "CONFIRMATION_MISSING" };
    case "TRANSACTION_MATCH":
      if (observation.transactionMatched === true) return { outcome: "PASS", reasonCode: "TRANSACTION_MATCHED" };
      if (observation.transactionMatched === false) return { outcome: "FAIL", reasonCode: "TRANSACTION_MISMATCH" };
      return { outcome: "FAIL", reasonCode: "EVIDENCE_MISSING" };
    case "BUSINESS_PURPOSE":
      if (observation.businessPurposePresent === true) return { outcome: "PASS", reasonCode: "BUSINESS_PURPOSE_PRESENT" };
      return { outcome: "FAIL", reasonCode: "BUSINESS_PURPOSE_MISSING" };
    case "DUE_DATE": {
      if (input.milestone.dueAt === null) return { outcome: "REVIEW", reasonCode: "EVIDENCE_MISSING" };
      const dueAt = finiteTime(input.milestone.dueAt);
      const evaluatedAt = finiteTime(input.evaluatedAt);
      if (dueAt === null || evaluatedAt === null) return { outcome: "REVIEW", reasonCode: "EVIDENCE_MISSING" };
      return evaluatedAt <= dueAt ? { outcome: "PASS", reasonCode: "DUE_DATE_VALID" } : { outcome: "FAIL", reasonCode: "DUE_DATE_EXPIRED" };
    }
    case "HUMAN_APPROVAL": {
      const approval = input.approvalRecord ?? null;
      const evaluatedAt = finiteTime(input.evaluatedAt);
      if (approval === null || approval.actionKind !== "MILESTONE_EVALUATION" || approval.aggregateId !== input.milestone.id) return { outcome: "REVIEW", reasonCode: "HUMAN_APPROVAL_PENDING" };
      if (approval.decision === "PENDING") return { outcome: "REVIEW", reasonCode: "HUMAN_APPROVAL_PENDING" };
      if (approval.decision === "REJECTED") return { outcome: "FAIL", reasonCode: "HUMAN_APPROVAL_REJECTED" };
      const expiresAt = finiteTime(approval.expiresAt);
      const decidedAt = approval.decidedAt === null ? null : finiteTime(approval.decidedAt);
      if (evaluatedAt === null || expiresAt === null || decidedAt === null || approval.decidedAt === null || decidedAt > evaluatedAt || evaluatedAt >= expiresAt) return { outcome: "REVIEW", reasonCode: "HUMAN_APPROVAL_PENDING" };
      return { outcome: "PASS", reasonCode: "HUMAN_APPROVAL_CONFIRMED" };
    }
  }
};

const normalizeRequired = (requirement: MilestoneRequirement): boolean => requirement.required !== false;
const compareByCodePoint = (left: string, right: string): number => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};
const validateRequirementSet = (milestoneId: string, milestoneRequirementIds: readonly string[], requirements: readonly MilestoneRequirement[]): void => {
  const milestoneIds = new Set(milestoneRequirementIds);
  if (milestoneIds.size !== milestoneRequirementIds.length) throw new Error("Milestone requirementIds must be unique.");
  const suppliedIds = new Set<string>();
  for (const requirement of requirements) {
    if (requirement.milestoneId !== milestoneId) throw new Error("Every requirement must belong to the evaluated milestone.");
    if (suppliedIds.has(requirement.id)) throw new Error("Supplied requirements must contain unique IDs.");
    suppliedIds.add(requirement.id);
  }
  if (suppliedIds.size !== milestoneIds.size) throw new Error("Supplied requirements must exactly match milestone.requirementIds.");
  for (const requirementId of milestoneIds) {
    if (!suppliedIds.has(requirementId)) throw new Error("Supplied requirements must exactly match milestone.requirementIds.");
  }
  for (const requirementId of suppliedIds) {
    if (!milestoneIds.has(requirementId)) throw new Error("Supplied requirements must exactly match milestone.requirementIds.");
  }
};
const isExactCurrentMilestoneApproval = (
  approval: ApprovalRecord | null,
  input: Pick<MilestoneEvaluationInput, "milestone" | "evaluatedAt" | "expectedApprovalIntentId" | "expectedApprovalExactIntentHash" | "expectedAuthorizedEvaluatorId">,
): boolean => {
  if (
    approval === null ||
    approval.actionKind !== "MILESTONE_EVALUATION" ||
    approval.authorizedActorType !== "EVALUATOR" ||
    approval.aggregateId !== input.milestone.id
  ) return false;
  const expectedIntentId = input.expectedApprovalIntentId;
  const expectedIntentHash = input.expectedApprovalExactIntentHash;
  const expectedEvaluatorId = input.expectedAuthorizedEvaluatorId;
  if (expectedIntentId === undefined || expectedIntentHash === undefined || expectedEvaluatorId === undefined) return false;
  if (
    approval.intentId !== expectedIntentId ||
    approval.exactIntentHash !== expectedIntentHash ||
    approval.authorizedActorId !== expectedEvaluatorId ||
    approval.decision !== "APPROVED" ||
    approval.approver === null ||
    approval.decidedAt === null ||
    approval.approver.actorType !== approval.authorizedActorType ||
    approval.approver.actorId !== approval.authorizedActorId
  ) return false;
  const evaluatedAt = finiteTime(input.evaluatedAt);
  const expiresAt = finiteTime(approval.expiresAt);
  const decidedAt = finiteTime(approval.decidedAt);
  if (evaluatedAt === null || expiresAt === null || decidedAt === null) return false;
  return decidedAt <= evaluatedAt && evaluatedAt < expiresAt;
};
const recommendedAction = (status: MilestoneEvaluationStatus, reasonCodes: readonly MilestoneReasonCode[], humanApprovalRequired: boolean): MilestoneNextAction => {
  if (status === "INCOMPLETE") return "PROVIDE_EVIDENCE";
  if (status === "NEEDS_REVIEW") return reasonCodes.includes("EVIDENCE_CONFLICT") ? "ANSWER_PROOF_RECOVERY" : "REQUEST_HUMAN_REVIEW";
  if (status === "ELIGIBLE" && humanApprovalRequired) return "REQUEST_HUMAN_APPROVAL";
  if (status === "ELIGIBLE" && !humanApprovalRequired) return "PREPARE_JOB_DRAFT";
  return "NONE";
};

export function evaluateMilestone(input: MilestoneEvaluationInput): MilestoneEvaluationResult {
  const parsed = MilestoneEvaluationInputSchema.parse(input);
  validateRequirementSet(parsed.milestone.id, parsed.milestone.requirementIds, parsed.requirements);
  const observations = parsed.observations ?? {};
  const reviewerNotesByRequirementId = parsed.reviewerNotesByRequirementId ?? {};
  const sortedRequirements = [...parsed.requirements].sort((left, right) => compareByCodePoint(left.id, right.id));
  const requirementEvaluations = sortedRequirements.map((requirement) => {
    const observation = RequirementObservationSchema.parse(observations[requirement.id] ?? {});
    const required = normalizeRequired(requirement);
    const outcome = evaluateByKind(requirement, observation, parsed);
    const isHumanApproval = requirement.kind === "HUMAN_APPROVAL";
    const blocksEligibility = isHumanApproval ? false : required && outcome.outcome !== "PASS";
    const blocksRelease = isHumanApproval ? outcome.outcome !== "PASS" : required && outcome.outcome !== "PASS";
    return RequirementEvaluationSchema.parse({
      requirementId: requirement.id,
      required,
      evidenceReferences: [...(observation.evidenceReferences ?? [])],
      outcome: outcome.outcome,
      reasonCodes: [outcome.reasonCode],
      reviewerNotes: reviewerNotesByRequirementId[requirement.id] ?? null,
      evaluatedAt: parsed.evaluatedAt,
      blocksEligibility,
      blocksRelease,
    });
  });
  const failingRequired = requirementEvaluations.some((item) => item.blocksEligibility && item.outcome === "FAIL");
  const pendingRequiredReview = requirementEvaluations.some((item) => item.blocksEligibility && item.outcome === "REVIEW");
  const status: MilestoneEvaluationStatus = failingRequired ? "INCOMPLETE" : pendingRequiredReview ? "NEEDS_REVIEW" : "ELIGIBLE";
  const reasonCodes: MilestoneReasonCode[] = [];
  for (const evaluation of requirementEvaluations) {
    for (const reason of evaluation.reasonCodes) {
      if (!reasonCodes.includes(reason)) reasonCodes.push(reason);
    }
  }
  const globalApprovalSatisfied = isExactCurrentMilestoneApproval(parsed.approvalRecord ?? null, parsed);
  const humanApprovalRequired = !globalApprovalSatisfied;
  const erc8183ActionPermitted = status === "ELIGIBLE" && !humanApprovalRequired;
  return MilestoneEvaluationResultSchema.parse({
    status,
    requirementEvaluations,
    reasonCodes,
    recommendedNextAction: recommendedAction(status, reasonCodes, humanApprovalRequired),
    policyVersion: parsed.policyVersion,
    evaluationTimestamp: parsed.evaluatedAt,
    humanApprovalRequired,
    erc8183ActionPermitted,
  });
}

export const AgenticJobDraftSchema = z.object({
  clientAddressReference: z.string().min(1),
  providerAddressReference: z.string().min(1),
  evaluatorAddressReference: z.string().min(1),
  expiry: z.string().datetime(),
  descriptionReference: z.string().min(1),
  budget: SettlementMoneyAmountSchema,
  hookAddressReference: z.string().min(1).nullable().default(null),
  deliverableHashPlaceholder: HashReferenceSchema,
  evaluationReasonHashPlaceholder: HashReferenceSchema,
  milestoneId: z.string().min(1),
  policyVersion: z.string().min(1),
  evaluationReference: z.string().datetime(),
});
export type AgenticJobDraft = z.infer<typeof AgenticJobDraftSchema>;

export const AgenticJobDraftInputSchema = AgenticJobDraftSchema.extend({
  approvedTrancheCeiling: SettlementMoneyAmountSchema,
  referenceTime: z.string().datetime(),
});
export type AgenticJobDraftInput = z.infer<typeof AgenticJobDraftInputSchema>;

export function createAgenticJobDraft(input: AgenticJobDraftInput): AgenticJobDraft {
  const parsed = AgenticJobDraftInputSchema.parse(input);
  if (compareAtomicUnits(parsed.budget.atomicUnits, "0") <= 0) throw new Error("Budget must be greater than zero atomic USDC units.");
  if (compareAtomicUnits(parsed.budget.atomicUnits, parsed.approvedTrancheCeiling.atomicUnits) > 0) throw new Error("Budget cannot exceed the approved tranche ceiling.");
  const expiry = finiteTime(parsed.expiry);
  const reference = finiteTime(parsed.referenceTime);
  if (expiry === null || reference === null || expiry <= reference) throw new Error("Expiry must be strictly in the future.");
  return AgenticJobDraftSchema.parse({
    clientAddressReference: parsed.clientAddressReference,
    providerAddressReference: parsed.providerAddressReference,
    evaluatorAddressReference: parsed.evaluatorAddressReference,
    expiry: parsed.expiry,
    descriptionReference: parsed.descriptionReference,
    budget: parsed.budget,
    hookAddressReference: parsed.hookAddressReference,
    deliverableHashPlaceholder: parsed.deliverableHashPlaceholder,
    evaluationReasonHashPlaceholder: parsed.evaluationReasonHashPlaceholder,
    milestoneId: parsed.milestoneId,
    policyVersion: parsed.policyVersion,
    evaluationReference: parsed.evaluationReference,
  });
}

export const Erc8183JobTransitionMap = AgenticJobTransitionMap;

export function isAllowedErc8183Transition(from: AgenticJobStatus, to: AgenticJobStatus): boolean {
  return isAllowedAgenticJobTransition(from, to);
}

export function assertErc8183Transition(from: AgenticJobStatus, to: AgenticJobStatus): void {
  assertAgenticJobTransition(from, to);
}
