import { z } from "zod";
import {
  ApprovalRecordSchema,
  AgenticJobStatusSchema,
  EvidenceItemSchema,
  EvidenceMatchSchema,
  MilestoneRequirementSchema,
  MilestoneSchema,
  SettlementMoneyAmountSchema,
  type Actor,
  type AgenticJobStatus,
  type ApprovalRecord,
  type EvidenceItem,
  type EvidenceMatch,
  type MilestoneRequirement,
} from "./models";
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
  evidenceItems: z.array(EvidenceItemSchema).optional(),
  evidenceMatches: z.array(EvidenceMatchSchema).optional(),
  verifiedSpend: SettlementMoneyAmountSchema.optional(),
  policyVersion: z.string().min(1),
  evaluatedAt: z.string().datetime(),
  approvalRecord: ApprovalRecordSchema.nullable().optional(),
  expectedApprovalIntentId: z.string().min(1).optional(),
  expectedApprovalExactIntentHash: HashReferenceSchema.optional(),
  expectedAuthorizedEvaluatorId: z.string().min(1).optional(),
  expectedAuthorizedFounderId: z.string().min(1).optional(),
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
type MilestoneApprovalClassification = "PENDING" | "REJECTED" | "CONFIRMED";
type RequirementProvenance = {
  hasAcceptedHumanDecision: boolean;
  hasAiSuggestion: boolean;
  acceptedEvidenceByKind: Partial<Record<EvidenceItem["kind"], Set<string>>>;
};
type ProvenanceIndex = {
  byRequirementId: Map<string, RequirementProvenance>;
};

const SHA_256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;
const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));
const sha256 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
  const message = new Uint8Array(paddedLength);
  message.set(bytes);
  message[bytes.length] = 0x80;
  const view = new DataView(message.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  for (let i = 0; i < message.length; i += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + SHA_256_K[t] + w[t]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return `sha256:${h.map((part) => part.toString(16).padStart(8, "0")).join("")}`;
};
const countDistinctEvidenceReferences = (
  observation: RequirementObservation,
  legacyCount: number | undefined,
  legacyCountLabel: "deliverableCount" | "receiptCount",
): number => {
  const evidenceReferences = observation.evidenceReferences ?? [];
  const distinctReferenceCount = new Set(evidenceReferences).size;
  if (distinctReferenceCount !== evidenceReferences.length) throw new Error("Count-based evidence references must be unique.");
  if (legacyCount !== undefined && legacyCount !== distinctReferenceCount) {
    throw new Error(`${legacyCountLabel} must match the count of distinct evidence references.`);
  }
  return distinctReferenceCount;
};
const createProvenanceIndex = (input: Pick<MilestoneEvaluationInput, "milestone" | "requirements" | "evidenceItems" | "evidenceMatches">): ProvenanceIndex => {
  const requirementIds = new Set(input.requirements.map((requirement) => requirement.id));
  const evidenceById = new Map<string, EvidenceItem>();
  for (const evidence of input.evidenceItems ?? []) {
    if (evidence.projectId !== input.milestone.projectId) continue;
    if (evidenceById.has(evidence.id)) throw new Error("Evidence item IDs must be unique within a milestone evaluation.");
    evidenceById.set(evidence.id, evidence);
  }
  const byRequirementId = new Map<string, RequirementProvenance>();
  const ensureRequirement = (requirementId: string): RequirementProvenance => {
    const existing = byRequirementId.get(requirementId);
    if (existing !== undefined) return existing;
    const created: RequirementProvenance = { hasAcceptedHumanDecision: false, hasAiSuggestion: false, acceptedEvidenceByKind: {} };
    byRequirementId.set(requirementId, created);
    return created;
  };
  for (const match of input.evidenceMatches ?? []) {
    if (!requirementIds.has(match.requirementId)) continue;
    const evidence = evidenceById.get(match.evidenceId);
    if (evidence === undefined) continue;
    const requirement = ensureRequirement(match.requirementId);
    if (match.source === "AI_SUGGESTION") {
      requirement.hasAiSuggestion = true;
      continue;
    }
    requirement.hasAcceptedHumanDecision = true;
    const acceptedEvidence = requirement.acceptedEvidenceByKind[evidence.kind] ?? new Set<string>();
    acceptedEvidence.add(evidence.id);
    requirement.acceptedEvidenceByKind[evidence.kind] = acceptedEvidence;
  }
  return { byRequirementId };
};
const acceptedEvidenceCountByKind = (
  provenance: ProvenanceIndex,
  requirementId: string,
  kind: EvidenceItem["kind"],
): number => provenance.byRequirementId.get(requirementId)?.acceptedEvidenceByKind[kind]?.size ?? 0;
const hasAcceptedEvidence = (
  provenance: ProvenanceIndex,
  requirementId: string,
): boolean => provenance.byRequirementId.get(requirementId)?.hasAcceptedHumanDecision === true;
const hasAiOnlySuggestion = (
  provenance: ProvenanceIndex,
  requirementId: string,
): boolean => {
  const entry = provenance.byRequirementId.get(requirementId);
  return entry?.hasAiSuggestion === true && entry.hasAcceptedHumanDecision !== true;
};
const isAllowedConfirmationActor = (
  actor: Actor,
  expectedAuthorizedFounderId: string | undefined,
  expectedAuthorizedEvaluatorId: string | undefined,
): boolean =>
  (actor.actorType === "FOUNDER" && expectedAuthorizedFounderId !== undefined && actor.actorId === expectedAuthorizedFounderId) ||
  (actor.actorType === "EVALUATOR" && expectedAuthorizedEvaluatorId !== undefined && actor.actorId === expectedAuthorizedEvaluatorId);
const acceptedConfirmationCount = (
  requirementId: string,
  input: Pick<MilestoneEvaluationInput, "milestone" | "expectedAuthorizedFounderId" | "expectedAuthorizedEvaluatorId" | "evidenceItems" | "evidenceMatches">,
): number => {
  const evidenceById = new Map<string, EvidenceItem>();
  for (const evidence of input.evidenceItems ?? []) {
    if (evidence.projectId !== input.milestone.projectId || evidence.kind !== "CONFIRMATION") continue;
    evidenceById.set(evidence.id, evidence);
  }
  const acceptedEvidence = new Set<string>();
  for (const match of input.evidenceMatches ?? []) {
    if (match.source !== "HUMAN_DECISION" || match.requirementId !== requirementId) continue;
    if (!isAllowedConfirmationActor(match.acceptedBy, input.expectedAuthorizedFounderId, input.expectedAuthorizedEvaluatorId)) continue;
    if (!evidenceById.has(match.evidenceId)) continue;
    acceptedEvidence.add(match.evidenceId);
  }
  return acceptedEvidence.size;
};
const countValidatedEvidenceReferences = (
  requirement: MilestoneRequirement,
  observation: RequirementObservation,
  legacyCount: number | undefined,
  legacyCountLabel: "deliverableCount" | "receiptCount",
  evidenceKind: "DELIVERABLE" | "RECEIPT",
  provenance: ProvenanceIndex,
): number => {
  const referenceCount = countDistinctEvidenceReferences(observation, legacyCount, legacyCountLabel);
  const validatedCount = acceptedEvidenceCountByKind(provenance, requirement.id, evidenceKind);
  if (referenceCount !== validatedCount) throw new Error("Count-based evidence references must exactly match the distinct validated evidence set.");
  return validatedCount;
};
const evaluateByKind = (
  requirement: MilestoneRequirement,
  observation: RequirementObservation,
  input: MilestoneEvaluationInput,
  provenance: ProvenanceIndex,
): RequirementEvaluationComputation => {
  if (requirement.kind !== "HUMAN_APPROVAL" && observation.hasConflictingEvidence === true) return { outcome: "REVIEW", reasonCode: "EVIDENCE_CONFLICT" };
  switch (requirement.kind) {
    case "DELIVERABLE": {
      const deliverableCount = countValidatedEvidenceReferences(requirement, observation, observation.deliverableCount, "deliverableCount", "DELIVERABLE", provenance);
      return deliverableCount > 0 ? { outcome: "PASS", reasonCode: "DELIVERABLE_COUNT_MET" } : { outcome: "FAIL", reasonCode: "DELIVERABLE_COUNT_SHORT" };
    }
    case "EXPENSE_RECORDS": {
      const receiptCount = countValidatedEvidenceReferences(requirement, observation, observation.receiptCount, "receiptCount", "RECEIPT", provenance);
      return receiptCount >= requirement.requiredCount ? { outcome: "PASS", reasonCode: "RECEIPT_COUNT_MET" } : { outcome: "FAIL", reasonCode: "RECEIPT_COUNT_SHORT" };
    }
    case "SPEND_LIMIT": {
      if (input.verifiedSpend === undefined) return { outcome: "FAIL", reasonCode: "EVIDENCE_MISSING" };
      return compareAtomicUnits(input.verifiedSpend.atomicUnits, requirement.spendLimit.atomicUnits) <= 0
        ? { outcome: "PASS", reasonCode: "SPEND_WITHIN_LIMIT" }
        : { outcome: "FAIL", reasonCode: "SPEND_LIMIT_EXCEEDED" };
    }
    case "FOUNDER_CONFIRMATION":
      if (acceptedConfirmationCount(requirement.id, input) > 0) return { outcome: "PASS", reasonCode: "CONFIRMATION_PRESENT" };
      if (observation.founderConfirmationPresent === true || hasAiOnlySuggestion(provenance, requirement.id)) return { outcome: "REVIEW", reasonCode: "EVIDENCE_MISSING" };
      return { outcome: "FAIL", reasonCode: "CONFIRMATION_MISSING" };
    case "TRANSACTION_MATCH":
      if (hasAcceptedEvidence(provenance, requirement.id)) return { outcome: "PASS", reasonCode: "TRANSACTION_MATCHED" };
      if (observation.transactionMatched === false) return { outcome: "FAIL", reasonCode: "TRANSACTION_MISMATCH" };
      if (observation.transactionMatched === true || hasAiOnlySuggestion(provenance, requirement.id)) return { outcome: "REVIEW", reasonCode: "EVIDENCE_MISSING" };
      return { outcome: "FAIL", reasonCode: "EVIDENCE_MISSING" };
    case "BUSINESS_PURPOSE":
      if (hasAcceptedEvidence(provenance, requirement.id)) return { outcome: "PASS", reasonCode: "BUSINESS_PURPOSE_PRESENT" };
      if (observation.businessPurposePresent === true || hasAiOnlySuggestion(provenance, requirement.id)) return { outcome: "REVIEW", reasonCode: "EVIDENCE_MISSING" };
      return { outcome: "FAIL", reasonCode: "BUSINESS_PURPOSE_MISSING" };
    case "DUE_DATE": {
      if (input.milestone.dueAt === null) return { outcome: "REVIEW", reasonCode: "EVIDENCE_MISSING" };
      const dueAt = finiteTime(input.milestone.dueAt);
      const evaluatedAt = finiteTime(input.evaluatedAt);
      if (dueAt === null || evaluatedAt === null) return { outcome: "REVIEW", reasonCode: "EVIDENCE_MISSING" };
      return evaluatedAt <= dueAt ? { outcome: "PASS", reasonCode: "DUE_DATE_VALID" } : { outcome: "FAIL", reasonCode: "DUE_DATE_EXPIRED" };
    }
    case "HUMAN_APPROVAL": {
      const approval = classifyMilestoneApproval(input.approvalRecord ?? null, input);
      if (approval === "CONFIRMED") return { outcome: "PASS", reasonCode: "HUMAN_APPROVAL_CONFIRMED" };
      if (approval === "REJECTED") return { outcome: "FAIL", reasonCode: "HUMAN_APPROVAL_REJECTED" };
      return { outcome: "REVIEW", reasonCode: "HUMAN_APPROVAL_PENDING" };
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
type CanonicalMilestoneEvaluationApprovalSubjectInput = Pick<
  MilestoneEvaluationInput,
  "milestone" | "requirements" | "observations" | "verifiedSpend" | "policyVersion" | "evidenceItems" | "evidenceMatches"
>;
const serializeCanonicalMilestoneEvaluationApprovalSubject = (input: CanonicalMilestoneEvaluationApprovalSubjectInput): string => {
  const normalizedRequirements = [...input.requirements]
    .sort((left, right) => compareByCodePoint(left.id, right.id))
    .map((requirement) => [
      requirement.id,
      requirement.milestoneId,
      requirement.kind,
      requirement.description,
      requirement.required ?? true,
      "requiredCount" in requirement ? requirement.requiredCount : null,
      "spendLimit" in requirement ? requirement.spendLimit?.asset ?? null : null,
      "spendLimit" in requirement ? requirement.spendLimit?.atomicUnits ?? null : null,
    ]);
  const observations = input.observations ?? {};
  const normalizedObservations = Object.keys(observations)
    .sort(compareByCodePoint)
    .map((requirementId) => {
      const parsed = RequirementObservationSchema.parse(observations[requirementId]);
      const refs = [...new Set(parsed.evidenceReferences ?? [])].sort(compareByCodePoint);
      return [
        requirementId,
        refs,
        parsed.hasConflictingEvidence ?? null,
        parsed.deliverableCount ?? null,
        parsed.receiptCount ?? null,
      ];
    });
  const normalizedEvidenceItems = [...(input.evidenceItems ?? [])]
    .filter((item) => item.projectId === input.milestone.projectId)
    .sort((left, right) => compareByCodePoint(left.id, right.id))
    .map((item) => [item.id, item.projectId, item.kind, item.sourceHash, item.storageRef, item.visibility, item.submittedAt]);
  const normalizedAcceptedEvidenceMatches = [...(input.evidenceMatches ?? [])]
    .filter((match) => match.source === "HUMAN_DECISION")
    .sort((left, right) =>
      compareByCodePoint(left.requirementId, right.requirementId) ||
      compareByCodePoint(left.evidenceId, right.evidenceId) ||
      compareByCodePoint(left.id, right.id))
    .map((match) => [match.id, match.evidenceId, match.requirementId, match.source, match.acceptedBy.actorType, match.acceptedBy.actorId]);
  return JSON.stringify([
    1,
    "MILESTONE_EVALUATION",
    input.policyVersion,
    input.milestone.id,
    input.milestone.projectId,
    input.milestone.title,
    input.milestone.proposedAmount.asset,
    input.milestone.proposedAmount.atomicUnits,
    input.milestone.dueAt,
    [...input.milestone.requirementIds].sort(compareByCodePoint),
    normalizedRequirements,
    normalizedObservations,
    input.verifiedSpend?.asset ?? null,
    input.verifiedSpend?.atomicUnits ?? null,
    normalizedEvidenceItems,
    normalizedAcceptedEvidenceMatches,
  ]);
};
export const hashCanonicalMilestoneEvaluationApprovalSubject = (input: CanonicalMilestoneEvaluationApprovalSubjectInput): string => {
  return sha256(serializeCanonicalMilestoneEvaluationApprovalSubject(input));
};
const classifyMilestoneApproval = (
  approval: ApprovalRecord | null,
  input: Pick<
    MilestoneEvaluationInput,
    "milestone" | "requirements" | "observations" | "verifiedSpend" | "policyVersion" | "evidenceItems" | "evidenceMatches" |
    "evaluatedAt" | "expectedApprovalIntentId" | "expectedAuthorizedEvaluatorId"
  >,
): MilestoneApprovalClassification => {
  if (
    approval === null ||
    approval.actionKind !== "MILESTONE_EVALUATION" ||
    approval.authorizedActorType !== "EVALUATOR" ||
    approval.aggregateId !== input.milestone.id
  ) return "PENDING";
  const expectedIntentId = input.expectedApprovalIntentId;
  const expectedEvaluatorId = input.expectedAuthorizedEvaluatorId;
  if (expectedIntentId === undefined || expectedEvaluatorId === undefined) return "PENDING";
  const recomputedIntentHash = hashCanonicalMilestoneEvaluationApprovalSubject(input);
  if (
    approval.intentId !== expectedIntentId ||
    approval.exactIntentHash !== recomputedIntentHash ||
    approval.authorizedActorId !== expectedEvaluatorId ||
    approval.approver === null ||
    approval.decidedAt === null ||
    approval.approver.actorType !== approval.authorizedActorType ||
    approval.approver.actorId !== approval.authorizedActorId
  ) return "PENDING";
  const evaluatedAt = finiteTime(input.evaluatedAt);
  const expiresAt = finiteTime(approval.expiresAt);
  const decidedAt = finiteTime(approval.decidedAt);
  if (evaluatedAt === null || decidedAt === null || decidedAt > evaluatedAt) return "PENDING";
  if (approval.decision === "REJECTED") return "REJECTED";
  if (expiresAt === null || evaluatedAt >= expiresAt) return "PENDING";
  if (approval.decision === "APPROVED") return "CONFIRMED";
  return "PENDING";
};
const isExactCurrentMilestoneApproval = (
  approval: ApprovalRecord | null,
  input: Pick<
    MilestoneEvaluationInput,
    "milestone" | "requirements" | "observations" | "verifiedSpend" | "policyVersion" | "evidenceItems" | "evidenceMatches" |
    "evaluatedAt" | "expectedApprovalIntentId" | "expectedAuthorizedEvaluatorId"
  >,
): boolean => {
  return classifyMilestoneApproval(approval, input) === "CONFIRMED";
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
  const provenance = createProvenanceIndex(parsed);
  const observations = parsed.observations ?? {};
  const reviewerNotesByRequirementId = parsed.reviewerNotesByRequirementId ?? {};
  const sortedRequirements = [...parsed.requirements].sort((left, right) => compareByCodePoint(left.id, right.id));
  const requirementEvaluations = sortedRequirements.map((requirement) => {
    const observation = RequirementObservationSchema.parse(observations[requirement.id] ?? {});
    const required = normalizeRequired(requirement);
    const outcome = evaluateByKind(requirement, observation, parsed, provenance);
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
  const erc8183ActionPermitted = false;
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
