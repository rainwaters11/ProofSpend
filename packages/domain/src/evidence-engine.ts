import { z } from "zod";
import {
  MilestoneEvaluationResultSchema,
  MilestoneEvaluationStatusSchema,
  MilestoneNextActionSchema,
  MilestoneReasonCodeSchema,
  RequirementOutcomeSchema,
  evaluateMilestone,
  type MilestoneEvaluationResult,
  type RequirementObservation,
} from "./milestone-engine";
import {
  ActorSchema,
  AuditEventSchema,
  EvidenceItemSchema,
  EvidenceMatchSchema,
  MilestoneRequirementSchema,
  MilestoneSchema,
  ProofGapSchema,
  SettlementMoneyAmountSchema,
  type Actor,
  type AuditEvent,
  type EvidenceItem,
  type EvidenceMatch,
  type Milestone,
  type MilestoneRequirement,
  type ProofGap,
} from "./models";
import { createPawPovAiSeed } from "./seed";

const HashReferenceSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const IdReferenceSchema = z.string().min(1);
const TimeSchema = z.string().datetime();
const compareByCodePoint = (left: string, right: string): number => left === right ? 0 : left < right ? -1 : 1;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export const MockExtractionSuggestionSchema = z.object({
  evidenceId: IdReferenceSchema,
  observedFactCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)),
  normalizedValues: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()])),
  suggestedRequirementIds: z.array(IdReferenceSchema),
  confidenceBasisPoints: z.number().int().min(0).max(10_000).nullable(),
  unresolvedAmbiguityReasonCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/).nullable(),
}).strict();
export type MockExtractionSuggestion = z.infer<typeof MockExtractionSuggestionSchema>;

export interface MockEvidenceExtractor {
  extract(evidence: EvidenceItem): MockExtractionSuggestion;
}

export function createStaticMockEvidenceExtractor(fixtures: readonly MockExtractionSuggestion[]): MockEvidenceExtractor {
  const byEvidenceId = new Map<string, MockExtractionSuggestion>();
  for (const fixture of fixtures) {
    const parsed = MockExtractionSuggestionSchema.parse(fixture);
    if (byEvidenceId.has(parsed.evidenceId)) throw new Error("Mock extraction fixture evidence IDs must be unique.");
    byEvidenceId.set(parsed.evidenceId, parsed);
  }
  return {
    extract(evidence) {
      const parsedEvidence = EvidenceItemSchema.parse(evidence);
      const fixture = byEvidenceId.get(parsedEvidence.id);
      if (fixture === undefined) throw new Error(`No mock extraction fixture exists for evidence ${parsedEvidence.id}.`);
      return structuredClone(fixture);
    },
  };
}

export const EvidenceEngineInputSchema = z.object({
  milestone: MilestoneSchema,
  requirements: z.array(MilestoneRequirementSchema),
  evidenceItems: z.array(EvidenceItemSchema),
  evidenceMatches: z.array(EvidenceMatchSchema),
  verifiedSpend: SettlementMoneyAmountSchema,
  policyVersion: z.string().min(1),
  evaluatedAt: TimeSchema,
  expectedAuthorizedEvaluatorId: IdReferenceSchema,
  expectedAuthorizedFounderId: IdReferenceSchema,
}).strict();
export type EvidenceEngineInput = z.infer<typeof EvidenceEngineInputSchema>;

export const EvidenceEngineResultSchema = z.object({
  evaluation: MilestoneEvaluationResultSchema,
  proofGaps: z.array(ProofGapSchema),
}).strict();
export type EvidenceEngineResult = z.infer<typeof EvidenceEngineResultSchema>;

function validateEvidenceBoundary(input: EvidenceEngineInput): void {
  const evidenceIds = new Set<string>();
  const evidenceHashes = new Set<string>();
  for (const evidence of input.evidenceItems) {
    if (Date.parse(evidence.submittedAt) > Date.parse(input.evaluatedAt)) throw new Error("Evidence Engine rejects evidence submitted after the evaluation timestamp.");
    if (evidence.projectId !== input.milestone.projectId) throw new Error("Evidence Engine rejects foreign-project evidence for a milestone evaluation.");
    if (evidenceIds.has(evidence.id)) throw new Error("Evidence IDs must be unique within the Evidence Engine slice.");
    if (evidenceHashes.has(evidence.sourceHash)) throw new Error("Canonical evidence hashes must be unique within the Evidence Engine slice.");
    evidenceIds.add(evidence.id);
    evidenceHashes.add(evidence.sourceHash);
  }

  const requirementIds = new Set(input.requirements.map((requirement) => requirement.id));
  const matchIds = new Set<string>();
  for (const match of input.evidenceMatches) {
    if (matchIds.has(match.id)) throw new Error("Evidence match IDs must be unique within the Evidence Engine slice.");
    if (!evidenceIds.has(match.evidenceId)) throw new Error("Evidence matches must reference evidence in the current milestone slice.");
    if (!requirementIds.has(match.requirementId)) throw new Error("Evidence matches must reference a requirement in the current milestone slice.");
    matchIds.add(match.id);
  }
}

function isAuthorizedHumanDecision(input: EvidenceEngineInput, match: EvidenceMatch): boolean {
  if (match.source !== "HUMAN_DECISION") return false;
  const requirement = input.requirements.find((candidate) => candidate.id === match.requirementId);
  if (requirement === undefined) return false;
  if (requirement.kind === "FOUNDER_CONFIRMATION") {
    return match.acceptedBy.actorType === "FOUNDER" && match.acceptedBy.actorId === input.expectedAuthorizedFounderId;
  }
  return (
    (match.acceptedBy.actorType === "FOUNDER" && match.acceptedBy.actorId === input.expectedAuthorizedFounderId) ||
    (match.acceptedBy.actorType === "EVALUATOR" && match.acceptedBy.actorId === input.expectedAuthorizedEvaluatorId)
  );
}

function policyEvidenceMatches(input: EvidenceEngineInput): EvidenceMatch[] {
  return input.evidenceMatches.filter((match) => match.source === "AI_SUGGESTION" || isAuthorizedHumanDecision(input, match));
}

function humanMatchesForRequirement(input: EvidenceEngineInput, requirementId: string): EvidenceMatch[] {
  return input.evidenceMatches.filter((match) => match.requirementId === requirementId && isAuthorizedHumanDecision(input, match));
}

function aiMatchesForRequirement(input: EvidenceEngineInput, requirementId: string): EvidenceMatch[] {
  return input.evidenceMatches.filter((match) => match.requirementId === requirementId && match.source === "AI_SUGGESTION");
}

function buildRequirementObservations(input: EvidenceEngineInput): Record<string, RequirementObservation> {
  const observations: Record<string, RequirementObservation> = {};
  for (const requirement of input.requirements) {
    const humanMatches = humanMatchesForRequirement(input, requirement.id);
    const aiMatches = aiMatchesForRequirement(input, requirement.id);
    const humanReferences = [...new Set(humanMatches.map((match) => match.evidenceId))].sort(compareByCodePoint);
    const suggestionPresent = humanMatches.length > 0 || aiMatches.length > 0;

    switch (requirement.kind) {
      case "DELIVERABLE":
        observations[requirement.id] = { evidenceReferences: humanReferences, deliverableCount: humanReferences.length };
        break;
      case "EXPENSE_RECORDS":
        observations[requirement.id] = { evidenceReferences: humanReferences, receiptCount: humanReferences.length };
        break;
      case "FOUNDER_CONFIRMATION":
        observations[requirement.id] = { evidenceReferences: humanReferences, founderConfirmationPresent: suggestionPresent || undefined };
        break;
      case "TRANSACTION_MATCH":
        observations[requirement.id] = { evidenceReferences: humanReferences, transactionMatched: suggestionPresent || undefined };
        break;
      case "BUSINESS_PURPOSE":
        observations[requirement.id] = { evidenceReferences: humanReferences, businessPurposePresent: suggestionPresent || undefined };
        break;
      case "SPEND_LIMIT":
      case "DUE_DATE":
      case "HUMAN_APPROVAL":
        observations[requirement.id] = { evidenceReferences: [] };
        break;
    }
  }
  return observations;
}

function detectMissingReceiptGap(input: EvidenceEngineInput, evaluation: MilestoneEvaluationResult): ProofGap[] {
  const expenseRequirement = input.requirements.find((requirement) => requirement.kind === "EXPENSE_RECORDS" && requirement.required !== false);
  if (expenseRequirement === undefined) return [];
  const expenseEvaluation = evaluation.requirementEvaluations.find((item) => item.requirementId === expenseRequirement.id);
  if (expenseEvaluation === undefined || !expenseEvaluation.reasonCodes.includes("RECEIPT_COUNT_SHORT")) return [];
  return [ProofGapSchema.parse({
    id: `proof-gap:${input.milestone.id}:missing-receipt`,
    milestoneId: input.milestone.id,
    requirementId: expenseRequirement.id,
    reasonCode: "RECEIPT_EVIDENCE_MISSING",
    question: "Please add the missing receipt required for this milestone.",
    priority: 0,
    resolvedAt: null,
  })];
}

export function evaluateEvidenceEngine(rawInput: EvidenceEngineInput): EvidenceEngineResult {
  const input = EvidenceEngineInputSchema.parse(rawInput);
  validateEvidenceBoundary(input);
  const evaluation = evaluateMilestone({
    milestone: input.milestone,
    requirements: input.requirements,
    observations: buildRequirementObservations(input),
    evidenceItems: input.evidenceItems,
    evidenceMatches: policyEvidenceMatches(input),
    verifiedSpend: input.verifiedSpend,
    policyVersion: input.policyVersion,
    evaluatedAt: input.evaluatedAt,
    approvalRecord: null,
    expectedAuthorizedEvaluatorId: input.expectedAuthorizedEvaluatorId,
    expectedAuthorizedFounderId: input.expectedAuthorizedFounderId,
  });
  return EvidenceEngineResultSchema.parse({ evaluation, proofGaps: detectMissingReceiptGap(input, evaluation) });
}

export const ProofRecoveryResultSchema = z.object({
  input: EvidenceEngineInputSchema,
  evaluation: MilestoneEvaluationResultSchema,
  originalGap: ProofGapSchema,
  resolvedGap: ProofGapSchema,
  auditEvents: z.array(AuditEventSchema),
}).strict();
export type ProofRecoveryResult = z.infer<typeof ProofRecoveryResultSchema>;

export function applyMissingReceiptRecovery(args: {
  input: EvidenceEngineInput;
  gap: ProofGap;
  receipt: EvidenceItem;
  acceptedMatch: EvidenceMatch;
  actor: Actor;
  resolvedAt: string;
  existingAuditEvents?: readonly AuditEvent[];
}): ProofRecoveryResult {
  const input = EvidenceEngineInputSchema.parse(args.input);
  const gap = ProofGapSchema.parse(args.gap);
  const receipt = EvidenceItemSchema.parse(args.receipt);
  const acceptedMatch = EvidenceMatchSchema.parse(args.acceptedMatch);
  const actor = ActorSchema.parse(args.actor);
  const resolvedAt = TimeSchema.parse(args.resolvedAt);
  const existingAuditEvents = (args.existingAuditEvents ?? []).map((event) => AuditEventSchema.parse(event));

  const current = evaluateEvidenceEngine(input);
  const currentGap = current.proofGaps.find((candidate) => candidate.id === gap.id);
  if (gap.resolvedAt !== null || currentGap === undefined || JSON.stringify(currentGap) !== JSON.stringify(gap)) {
    throw new Error("Proof Recovery requires the exact current unresolved proof gap.");
  }
  const requirement = input.requirements.find((candidate) => candidate.id === gap.requirementId);
  if (requirement?.kind !== "EXPENSE_RECORDS") throw new Error("This bounded Proof Recovery path accepts only the missing-receipt gap.");
  if (receipt.projectId !== input.milestone.projectId || receipt.kind !== "RECEIPT") throw new Error("Proof Recovery receipt must be a founder-private receipt for the current project.");
  if (acceptedMatch.source !== "HUMAN_DECISION" || acceptedMatch.evidenceId !== receipt.id || acceptedMatch.requirementId !== gap.requirementId) {
    throw new Error("Recovered receipt requires an accepted human decision for the exact proof gap requirement.");
  }
  if (acceptedMatch.acceptedBy.actorId !== actor.actorId || acceptedMatch.acceptedBy.actorType !== actor.actorType) {
    throw new Error("Proof Recovery audit actor must be the actor accepting the recovered evidence.");
  }
  const auditEvent = AuditEventSchema.parse({
    id: `audit:${gap.id}:${receipt.id}`,
    aggregateType: "PROOF_GAP",
    aggregateId: gap.id,
    eventType: "PROOF_RECOVERY_ACCEPTED",
    actor,
    idempotencyKey: `recovery:${gap.id}:${receipt.id}`,
    occurredAt: resolvedAt,
    details: {
      proofGapId: gap.id,
      requirementId: gap.requirementId,
      acceptedMatchId: acceptedMatch.id,
      evidenceId: receipt.id,
      evidenceHash: receipt.sourceHash,
      resolution: "ADDITIONAL_RECEIPT_ACCEPTED",
    },
  });
  const collidingRecoveryEvents = existingAuditEvents.filter((event) =>
    (
      event.aggregateType === "PROOF_GAP" &&
      event.aggregateId === gap.id &&
      event.eventType === "PROOF_RECOVERY_ACCEPTED"
    ) ||
    event.id === auditEvent.id ||
    (auditEvent.idempotencyKey !== null && event.idempotencyKey === auditEvent.idempotencyKey)
  );
  if (collidingRecoveryEvents.some((event) => JSON.stringify(event) !== JSON.stringify(auditEvent))) {
    throw new Error("Proof Recovery gap, idempotency key, or audit event ID is already bound to a conflicting recovery event.");
  }
  const isExactRetry = collidingRecoveryEvents.length > 0;
  const resolvedAtMillis = Date.parse(resolvedAt);
  if (
    resolvedAtMillis < Date.parse(input.evaluatedAt) ||
    resolvedAtMillis < Date.parse(receipt.submittedAt) ||
    (!isExactRetry && existingAuditEvents.some((event) => Date.parse(event.occurredAt) > resolvedAtMillis))
  ) {
    throw new Error("Proof Recovery time must not precede the prior evaluation, recovered receipt, or existing audit history.");
  }

  const recoveredInput = EvidenceEngineInputSchema.parse({
    ...input,
    evidenceItems: [...input.evidenceItems, receipt],
    evidenceMatches: [...input.evidenceMatches, acceptedMatch],
    evaluatedAt: resolvedAt,
  });
  const recovered = evaluateEvidenceEngine(recoveredInput);
  if (recovered.proofGaps.some((candidate) => candidate.id === gap.id)) throw new Error("Recovered receipt did not clear the intended proof gap.");

  const auditEvents = isExactRetry ? existingAuditEvents : [...existingAuditEvents, auditEvent];

  return ProofRecoveryResultSchema.parse({
    input: recoveredInput,
    evaluation: recovered.evaluation,
    originalGap: gap,
    resolvedGap: { ...gap, resolvedAt },
    auditEvents,
  });
}

export const AcceptedEvidenceBindingSchema = z.object({
  acceptedMatchId: IdReferenceSchema,
  evidenceId: IdReferenceSchema,
  evidenceHash: HashReferenceSchema,
  requirementId: IdReferenceSchema,
  decisionSource: z.literal("HUMAN_DECISION"),
  acceptedBy: ActorSchema,
}).strict();
export type AcceptedEvidenceBinding = z.infer<typeof AcceptedEvidenceBindingSchema>;

export const MilestonePolicyDefinitionSchema = MilestoneSchema.omit({ status: true }).strict();
export type MilestonePolicyDefinition = z.infer<typeof MilestonePolicyDefinitionSchema>;

export const MilestoneEvaluationPacketSchema = z.object({
  packetVersion: z.literal(1),
  milestoneId: IdReferenceSchema,
  milestoneDefinition: MilestonePolicyDefinitionSchema,
  evaluationStatus: MilestoneEvaluationStatusSchema,
  policyVersion: z.string().min(1),
  evaluationTimestamp: TimeSchema,
  evidenceIds: z.array(IdReferenceSchema),
  evidenceHashes: z.array(HashReferenceSchema),
  evidenceBindings: z.array(AcceptedEvidenceBindingSchema),
  requirementDefinitions: z.array(MilestoneRequirementSchema),
  requirementOutcomes: z.array(z.object({
    requirementId: IdReferenceSchema,
    outcome: RequirementOutcomeSchema,
    reasonCodes: z.array(MilestoneReasonCodeSchema).min(1),
  }).strict()),
  verifiedSpend: SettlementMoneyAmountSchema,
  unresolvedProofGapIds: z.array(IdReferenceSchema),
  recommendedNextAction: MilestoneNextActionSchema,
  deliverableHashCandidate: HashReferenceSchema,
  reasonHashCandidate: HashReferenceSchema,
  generatedAt: TimeSchema,
}).strict();
export type MilestoneEvaluationPacket = z.infer<typeof MilestoneEvaluationPacketSchema>;

export async function buildMilestoneEvaluationPacket(args: {
  input: EvidenceEngineInput;
  evaluation: MilestoneEvaluationResult;
  proofGaps: readonly ProofGap[];
  generatedAt: string;
}): Promise<MilestoneEvaluationPacket> {
  const input = EvidenceEngineInputSchema.parse(args.input);
  const evaluation = MilestoneEvaluationResultSchema.parse(args.evaluation);
  const proofGaps = args.proofGaps.map((gap) => ProofGapSchema.parse(gap));
  const generatedAt = TimeSchema.parse(args.generatedAt);
  validateEvidenceBoundary(input);

  const recomputed = evaluateEvidenceEngine(input);
  if (JSON.stringify(recomputed.evaluation) !== JSON.stringify(evaluation)) {
    throw new Error("Evaluator packet evaluation must match the exact current Evidence Engine input.");
  }
  if (Date.parse(generatedAt) < Date.parse(evaluation.evaluationTimestamp)) {
    throw new Error("Evaluator packet generation time cannot precede the evaluation timestamp.");
  }
  if (proofGaps.some((gap) => gap.milestoneId !== input.milestone.id || !input.milestone.requirementIds.includes(gap.requirementId))) {
    throw new Error("Evaluator packet proof gaps must belong to the exact milestone and requirement set.");
  }
  const suppliedUnresolvedGapIds = proofGaps.filter((gap) => gap.resolvedAt === null).map((gap) => gap.id).sort(compareByCodePoint);
  const currentUnresolvedGapIds = recomputed.proofGaps.map((gap) => gap.id).sort(compareByCodePoint);
  if (JSON.stringify(suppliedUnresolvedGapIds) !== JSON.stringify(currentUnresolvedGapIds)) {
    throw new Error("Evaluator packet unresolved proof gaps must match the current Evidence Engine result.");
  }
  if (evaluation.erc8183ActionPermitted) throw new Error("Issue #5 evaluator packets cannot authorize an ERC-8183 write.");

  const milestoneDefinition = MilestonePolicyDefinitionSchema.parse({
    id: input.milestone.id,
    projectId: input.milestone.projectId,
    title: input.milestone.title,
    proposedAmount: input.milestone.proposedAmount,
    requirementIds: [...input.milestone.requirementIds].sort(compareByCodePoint),
    dueAt: input.milestone.dueAt,
  });
  const requirementDefinitions = input.requirements
    .map((requirement) => MilestoneRequirementSchema.parse({ ...requirement, required: requirement.required ?? true }))
    .sort((left, right) => compareByCodePoint(left.id, right.id));
  const evidenceById = new Map(input.evidenceItems.map((item) => [item.id, item] as const));
  const evidenceBindingKeys = new Set<string>();
  const evidenceBindings = input.evidenceMatches
    .filter((match) => isAuthorizedHumanDecision(input, match))
    .map((match) => {
      const evidence = evidenceById.get(match.evidenceId);
      if (evidence === undefined) throw new Error("Accepted evidence binding references missing evidence.");
      return AcceptedEvidenceBindingSchema.parse({
        acceptedMatchId: match.id,
        evidenceId: evidence.id,
        evidenceHash: evidence.sourceHash,
        requirementId: match.requirementId,
        decisionSource: match.source,
        acceptedBy: match.acceptedBy,
      });
    })
    .filter((binding) => {
      const key = JSON.stringify([
        binding.acceptedMatchId,
        binding.evidenceId,
        binding.evidenceHash,
        binding.requirementId,
        binding.decisionSource,
        binding.acceptedBy.actorType,
        binding.acceptedBy.actorId,
      ]);
      if (evidenceBindingKeys.has(key)) return false;
      evidenceBindingKeys.add(key);
      return true;
    })
    .sort((left, right) => compareByCodePoint(
      JSON.stringify([left.requirementId, left.evidenceId, left.acceptedMatchId, left.evidenceHash, left.acceptedBy.actorType, left.acceptedBy.actorId]),
      JSON.stringify([right.requirementId, right.evidenceId, right.acceptedMatchId, right.evidenceHash, right.acceptedBy.actorType, right.acceptedBy.actorId]),
    ));
  const acceptedEvidenceIdSet = new Set(evidenceBindings.map((binding) => binding.evidenceId));
  const acceptedEvidence = input.evidenceItems.filter((item) => acceptedEvidenceIdSet.has(item.id));
  const evidenceIds = acceptedEvidence.map((item) => item.id).sort(compareByCodePoint);
  const evidenceHashes = acceptedEvidence.map((item) => item.sourceHash).sort(compareByCodePoint);
  const requirementOutcomes = [...evaluation.requirementEvaluations]
    .sort((left, right) => compareByCodePoint(left.requirementId, right.requirementId))
    .map((item) => ({ requirementId: item.requirementId, outcome: item.outcome, reasonCodes: [...item.reasonCodes].sort(compareByCodePoint) }));

  const deliverableSubject = JSON.stringify([
    1,
    milestoneDefinition,
    evaluation.status,
    evaluation.policyVersion,
    evaluation.evaluationTimestamp,
    evidenceBindings,
    requirementDefinitions,
    requirementOutcomes,
    input.verifiedSpend.asset,
    input.verifiedSpend.atomicUnits,
  ]);
  const reasonSubject = JSON.stringify([
    1,
    milestoneDefinition,
    evaluation.status,
    evaluation.policyVersion,
    evaluation.evaluationTimestamp,
    evidenceBindings,
    requirementDefinitions,
    requirementOutcomes,
    suppliedUnresolvedGapIds,
    evaluation.recommendedNextAction,
    input.verifiedSpend.asset,
    input.verifiedSpend.atomicUnits,
  ]);

  return MilestoneEvaluationPacketSchema.parse({
    packetVersion: 1,
    milestoneId: input.milestone.id,
    milestoneDefinition,
    evaluationStatus: evaluation.status,
    policyVersion: evaluation.policyVersion,
    evaluationTimestamp: evaluation.evaluationTimestamp,
    evidenceIds,
    evidenceHashes,
    evidenceBindings,
    requirementDefinitions,
    requirementOutcomes,
    verifiedSpend: input.verifiedSpend,
    unresolvedProofGapIds: suppliedUnresolvedGapIds,
    recommendedNextAction: evaluation.recommendedNextAction,
    deliverableHashCandidate: await sha256(deliverableSubject),
    reasonHashCandidate: await sha256(reasonSubject),
    generatedAt,
  });
}

export interface PawPovAiEvidenceScenario {
  milestone: Milestone;
  requirements: MilestoneRequirement[];
  initialInput: EvidenceEngineInput;
  recoveryReceipt: EvidenceItem;
  recoveryMatch: EvidenceMatch;
  authorizedFounder: Actor;
  authorizedEvaluator: Actor;
}

export function createPawPovAiEvidenceScenario(): PawPovAiEvidenceScenario {
  const seed = createPawPovAiSeed();
  const authorizedFounder = ActorSchema.parse({ actorId: seed.project.founderId, actorType: "FOUNDER" });
  const authorizedEvaluator = ActorSchema.parse({ actorId: "evaluator:proofspend", actorType: "EVALUATOR" });
  const requirements = [
    ...seed.requirements,
    MilestoneRequirementSchema.parse({ id: "requirement:transaction-match", milestoneId: seed.milestone.id, kind: "TRANSACTION_MATCH", description: "Transaction context matches the milestone" }),
    MilestoneRequirementSchema.parse({ id: "requirement:business-purpose", milestoneId: seed.milestone.id, kind: "BUSINESS_PURPOSE", description: "Business purpose is present" }),
  ];
  const milestone = MilestoneSchema.parse({ ...seed.milestone, requirementIds: requirements.map((requirement) => requirement.id) });
  const submittedAt = "2026-01-20T00:00:00.000Z";
  const evidence = {
    deliverable: EvidenceItemSchema.parse({ id: "evidence:pawpovai:deliverable", projectId: seed.project.id, kind: "DELIVERABLE", sourceHash: `sha256:${"1".repeat(64)}`, storageRef: "private://pawpovai/deliverable", visibility: "FOUNDER_PRIVATE", submittedAt }),
    landing: EvidenceItemSchema.parse({ id: "evidence:pawpovai:landing", projectId: seed.project.id, kind: "DELIVERABLE", sourceHash: `sha256:${"8".repeat(64)}`, storageRef: "private://pawpovai/landing-page-screenshot", visibility: "FOUNDER_PRIVATE", submittedAt }),
    flyer: EvidenceItemSchema.parse({ id: "evidence:pawpovai:flyer", projectId: seed.project.id, kind: "DELIVERABLE", sourceHash: `sha256:${"9".repeat(64)}`, storageRef: "private://pawpovai/promotional-flyer", visibility: "FOUNDER_PRIVATE", submittedAt }),
    receiptOne: EvidenceItemSchema.parse({ id: "evidence:pawpovai:receipt:1", projectId: seed.project.id, kind: "RECEIPT", sourceHash: `sha256:${"2".repeat(64)}`, storageRef: "private://pawpovai/receipt/1", visibility: "FOUNDER_PRIVATE", submittedAt }),
    receiptTwo: EvidenceItemSchema.parse({ id: "evidence:pawpovai:receipt:2", projectId: seed.project.id, kind: "RECEIPT", sourceHash: `sha256:${"3".repeat(64)}`, storageRef: "private://pawpovai/receipt/2", visibility: "FOUNDER_PRIVATE", submittedAt }),
    confirmation: EvidenceItemSchema.parse({ id: "evidence:pawpovai:confirmation", projectId: seed.project.id, kind: "CONFIRMATION", sourceHash: `sha256:${"4".repeat(64)}`, storageRef: "private://pawpovai/confirmation", visibility: "FOUNDER_PRIVATE", submittedAt }),
    transaction: EvidenceItemSchema.parse({ id: "evidence:pawpovai:transaction-context", projectId: seed.project.id, kind: "STATEMENT", sourceHash: `sha256:${"5".repeat(64)}`, storageRef: "private://pawpovai/transaction-context", visibility: "FOUNDER_PRIVATE", submittedAt }),
    purpose: EvidenceItemSchema.parse({ id: "evidence:pawpovai:business-purpose", projectId: seed.project.id, kind: "STATEMENT", sourceHash: `sha256:${"6".repeat(64)}`, storageRef: "private://pawpovai/business-purpose", visibility: "FOUNDER_PRIVATE", submittedAt }),
  };
  const humanMatch = (id: string, evidenceId: string, requirementId: string, acceptedBy: Actor): EvidenceMatch => EvidenceMatchSchema.parse({
    id,
    evidenceId,
    requirementId,
    source: "HUMAN_DECISION",
    confidenceBasisPoints: null,
    explanation: "Accepted structured mock evidence.",
    acceptedBy,
  });

  const initialInput = EvidenceEngineInputSchema.parse({
    milestone,
    requirements,
    evidenceItems: [evidence.deliverable, evidence.landing, evidence.flyer, evidence.receiptOne, evidence.confirmation, evidence.transaction, evidence.purpose],
    evidenceMatches: [
      humanMatch("match:pawpovai:deliverable", evidence.deliverable.id, "requirement:identity", authorizedEvaluator),
      humanMatch("match:pawpovai:landing", evidence.landing.id, "requirement:landing", authorizedEvaluator),
      humanMatch("match:pawpovai:flyer", evidence.flyer.id, "requirement:flyer", authorizedEvaluator),
      humanMatch("match:pawpovai:receipt:1", evidence.receiptOne.id, "requirement:expenses", authorizedEvaluator),
      humanMatch("match:pawpovai:confirmation", evidence.confirmation.id, "requirement:confirmation", authorizedFounder),
      humanMatch("match:pawpovai:transaction-context", evidence.transaction.id, "requirement:transaction-match", authorizedEvaluator),
      humanMatch("match:pawpovai:business-purpose", evidence.purpose.id, "requirement:business-purpose", authorizedEvaluator),
    ],
    verifiedSpend: SettlementMoneyAmountSchema.parse({ asset: "USDC", atomicUnits: "125000000" }),
    policyVersion: "policy:pawpovai:v1",
    evaluatedAt: submittedAt,
    expectedAuthorizedEvaluatorId: authorizedEvaluator.actorId,
    expectedAuthorizedFounderId: authorizedFounder.actorId,
  });

  return {
    milestone,
    requirements: structuredClone(requirements),
    initialInput,
    recoveryReceipt: evidence.receiptTwo,
    recoveryMatch: humanMatch("match:pawpovai:receipt:2", evidence.receiptTwo.id, "requirement:expenses", authorizedFounder),
    authorizedFounder,
    authorizedEvaluator,
  };
}
