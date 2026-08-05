import { AgenticJobRefSchema, ApprovalRecordSchema, CanonicalExecutionIntentSchema, ExecutionAuthorizationBindingSchema, JobEvaluationEvidenceSchema, ReconciliationRecordSchema, SettlementRecordSchema, SubmissionOperationRecordSchema, TransactionRecordSchema, type Actor, type AgenticJobRef, type AgenticJobStatus, type ApprovalRecord, type AuditEvent, type ExecutionAuthorizationBinding, type JobEvaluationEvidence, type ReconciliationRecord, type SettlementRecord, type SubmissionOperationRecord, type TransactionRecord } from "./models";
import { hashCanonicalExecutionIntent, validateReconciliation } from "./integrity";

export class InvalidTransitionError extends Error {
  constructor(readonly machine: string, readonly from: string, readonly to: string) {
    super(`Invalid ${machine} transition from ${from} to ${to}.`); this.name = "InvalidTransitionError";
  }
}
export type ProofSpendApplicationState = "INCOMPLETE" | "NEEDS_REVIEW" | "ELIGIBLE" | "APPROVAL_PENDING" | "APPROVED" | "PREPARED" | "SUBMITTED" | "CONFIRMED" | "REJECTED" | "FAILED" | "RECONCILED";
const applicationTransitions: Record<ProofSpendApplicationState, readonly ProofSpendApplicationState[]> = {
  INCOMPLETE: ["NEEDS_REVIEW"], NEEDS_REVIEW: ["INCOMPLETE", "ELIGIBLE", "REJECTED"], ELIGIBLE: ["APPROVAL_PENDING"],
  APPROVAL_PENDING: ["APPROVED", "REJECTED"], APPROVED: ["PREPARED"], PREPARED: ["FAILED"],
  SUBMITTED: ["CONFIRMED", "FAILED"], CONFIRMED: ["RECONCILED"], REJECTED: [], FAILED: [], RECONCILED: [],
};
const jobTransitions: Record<AgenticJobStatus, readonly AgenticJobStatus[]> = {
  OPEN: ["FUNDED", "EXPIRED"], FUNDED: ["SUBMITTED", "EXPIRED"], SUBMITTED: ["COMPLETED", "REJECTED", "EXPIRED"],
  COMPLETED: [], REJECTED: [], EXPIRED: [],
};
export interface TransitionContext {
  aggregateType: string; aggregateId: string; eventId: string; occurredAt: string; actor: Actor;
  authorizedSystemId?: string; authorizedApproverId?: string; authorizedAdapterId?: string; authorizedProviderId?: string; authorizedEvaluatorId?: string; idempotencyKey?: string;
  confirmationTransaction?: TransactionRecord; expectedTransactionId?: string; expectedProjectId?: string; expectedReleaseRequestId?: string; expectedOperationType?: NonNullable<TransactionRecord["arcTransaction"]>["operationType"];
  expectedIntentId?: string; expectedApprovalId?: string; expectedApprovalBindingId?: string; expectedExactIntentHash?: string;
  submissionTransaction?: TransactionRecord; executionBinding?: ExecutionAuthorizationBinding; submissionOperation?: SubmissionOperationRecord;
  reconciliationTransaction?: TransactionRecord; reconciliationSettlement?: SettlementRecord; reconciliationRecord?: ReconciliationRecord;
  approvalDecision?: ApprovalRecord; lifecycleTransaction?: TransactionRecord;
  jobEvidence?: AgenticJobRef; currentJobEvidence?: AgenticJobRef; jobApprovalDecision?: ApprovalRecord;
  jobEvaluationEvidence?: JobEvaluationEvidence;
}
type ApplicationEdge = `${ProofSpendApplicationState}->${ProofSpendApplicationState}`;
type AuthorityRule = { actorTypes: readonly Actor["actorType"][]; identifier: "authorizedSystemId" | "authorizedApproverId" | "authorizedAdapterId" };
const applicationAuthority: Partial<Record<ApplicationEdge, AuthorityRule>> = {
  "INCOMPLETE->NEEDS_REVIEW": { actorTypes: ["SYSTEM"], identifier: "authorizedSystemId" },
  "NEEDS_REVIEW->INCOMPLETE": { actorTypes: ["SYSTEM"], identifier: "authorizedSystemId" },
  "NEEDS_REVIEW->ELIGIBLE": { actorTypes: ["SYSTEM"], identifier: "authorizedSystemId" },
  "NEEDS_REVIEW->REJECTED": { actorTypes: ["SYSTEM"], identifier: "authorizedSystemId" },
  "ELIGIBLE->APPROVAL_PENDING": { actorTypes: ["SYSTEM"], identifier: "authorizedSystemId" },
  "APPROVAL_PENDING->APPROVED": { actorTypes: ["FOUNDER", "EVALUATOR"], identifier: "authorizedApproverId" },
  "APPROVAL_PENDING->REJECTED": { actorTypes: ["FOUNDER", "EVALUATOR"], identifier: "authorizedApproverId" },
  "APPROVED->PREPARED": { actorTypes: ["ADAPTER"], identifier: "authorizedAdapterId" },
  "PREPARED->FAILED": { actorTypes: ["ADAPTER"], identifier: "authorizedAdapterId" },
  "SUBMITTED->CONFIRMED": { actorTypes: ["ADAPTER"], identifier: "authorizedAdapterId" },
  "SUBMITTED->FAILED": { actorTypes: ["ADAPTER"], identifier: "authorizedAdapterId" },
  "CONFIRMED->RECONCILED": { actorTypes: ["ADAPTER"], identifier: "authorizedAdapterId" },
};
type JobEdge = `${AgenticJobStatus}->${AgenticJobStatus}`;
type JobAuthorityRule = { actorType: "ADAPTER" | "EVALUATOR" | "SYSTEM"; identifier: "authorizedAdapterId" | "authorizedEvaluatorId" | "authorizedSystemId" };
const jobAuthority: Partial<Record<JobEdge, JobAuthorityRule>> = {
  "OPEN->FUNDED": { actorType: "ADAPTER", identifier: "authorizedAdapterId" },
  "FUNDED->SUBMITTED": { actorType: "ADAPTER", identifier: "authorizedAdapterId" },
  "SUBMITTED->COMPLETED": { actorType: "EVALUATOR", identifier: "authorizedEvaluatorId" },
  "SUBMITTED->REJECTED": { actorType: "EVALUATOR", identifier: "authorizedEvaluatorId" },
  "OPEN->EXPIRED": { actorType: "SYSTEM", identifier: "authorizedSystemId" },
  "FUNDED->EXPIRED": { actorType: "SYSTEM", identifier: "authorizedSystemId" },
  "SUBMITTED->EXPIRED": { actorType: "SYSTEM", identifier: "authorizedSystemId" },
};
function event(context: TransitionContext, from: string, to: string): AuditEvent {
  return { id: context.eventId, aggregateType: context.aggregateType, aggregateId: context.aggregateId, eventType: "STATE_TRANSITIONED", actor: context.actor, idempotencyKey: context.idempotencyKey ?? null, occurredAt: context.occurredAt, details: { from, to } };
}
export function transitionApplication(from: ProofSpendApplicationState, to: ProofSpendApplicationState, context: TransitionContext) {
  if (!applicationTransitions[from].includes(to)) throw new InvalidTransitionError("ProofSpend application", from, to);
  const authority = applicationAuthority[`${from}->${to}`];
  if (authority === undefined || !authority.actorTypes.includes(context.actor.actorType) || context[authority.identifier] === undefined || context.actor.actorId !== context[authority.identifier]) throw new InvalidTransitionError("ProofSpend application authority", from, to);
  if (from === "APPROVAL_PENDING" && (to === "APPROVED" || to === "REJECTED")) {
    const approval = ApprovalRecordSchema.safeParse(context.approvalDecision);
    const expectedDecision = to === "APPROVED" ? "APPROVED" : "REJECTED";
    if (!approval.success || approval.data.aggregateId !== context.aggregateId || approval.data.intentId !== context.expectedIntentId || approval.data.id !== context.expectedApprovalId || approval.data.exactIntentHash !== context.expectedExactIntentHash || approval.data.decision !== expectedDecision || approval.data.approver === null || approval.data.decidedAt === null || approval.data.approver.actorType !== approval.data.authorizedActorType || approval.data.approver.actorId !== approval.data.authorizedActorId || context.actor.actorType !== approval.data.approver.actorType || context.actor.actorId !== approval.data.approver.actorId) throw new InvalidTransitionError("ProofSpend application approval evidence", from, to);
  }
  if (from === "APPROVED" && to === "PREPARED") validateLifecycleTransaction(context, "PREPARED", from, to);
  if ((from === "PREPARED" || from === "SUBMITTED") && to === "FAILED") validateLifecycleTransaction(context, "FAILED", from, to);
  if (from === "SUBMITTED" && to === "CONFIRMED") {
    const parsed = TransactionRecordSchema.safeParse(context.confirmationTransaction);
    const transaction = parsed.success ? parsed.data : null;
    if (transaction === null || transaction.operationState !== "CONFIRMED" || transaction.arcTransaction?.status !== "CONFIRMED" || context.expectedTransactionId === undefined || context.expectedProjectId === undefined || context.expectedReleaseRequestId === undefined || context.expectedIntentId === undefined || context.expectedApprovalId === undefined || context.expectedApprovalBindingId === undefined || context.aggregateId !== transaction.releaseRequestId || transaction.id !== context.expectedTransactionId || transaction.projectId !== context.expectedProjectId || transaction.releaseRequestId !== context.expectedReleaseRequestId || transaction.intentId !== context.expectedIntentId || transaction.approvalId !== context.expectedApprovalId || transaction.approvalBindingId !== context.expectedApprovalBindingId || (context.expectedOperationType !== "SETTLEMENT" && context.expectedOperationType !== "REFUND") || transaction.arcTransaction.operationType !== context.expectedOperationType) throw new InvalidTransitionError("ProofSpend application confirmation evidence", from, to);
  }
  if (from === "CONFIRMED" && to === "RECONCILED") {
    const transaction = TransactionRecordSchema.safeParse(context.reconciliationTransaction);
    const settlement = SettlementRecordSchema.safeParse(context.reconciliationSettlement);
    const reconciliation = ReconciliationRecordSchema.safeParse(context.reconciliationRecord);
    if (!transaction.success || !settlement.success || !reconciliation.success || reconciliation.data.result !== "MATCHED" || transaction.data.reconciliationId !== reconciliation.data.id || settlement.data.reconciliationId !== reconciliation.data.id || transaction.data.releaseRequestId !== settlement.data.releaseRequestId || context.aggregateId !== transaction.data.releaseRequestId) throw new InvalidTransitionError("ProofSpend application reconciliation evidence", from, to);
    try { validateReconciliation(transaction.data, settlement.data, reconciliation.data, context.authorizedAdapterId); } catch { throw new InvalidTransitionError("ProofSpend application reconciliation evidence", from, to); }
  }
  return { state: to, auditEvent: event(context, from, to) } as const;
}
function validateLifecycleTransaction(context: TransitionContext, status: "PREPARED" | "FAILED", from: string, to: string): void {
  const parsed = TransactionRecordSchema.safeParse(context.lifecycleTransaction);
  const transaction = parsed.success ? parsed.data : null;
  if (transaction === null || transaction.operationState !== status || transaction.arcTransaction?.status !== status || transaction.releaseRequestId !== context.aggregateId || transaction.id !== context.expectedTransactionId || transaction.projectId !== context.expectedProjectId || transaction.releaseRequestId !== context.expectedReleaseRequestId || transaction.intentId !== context.expectedIntentId || transaction.approvalId !== context.expectedApprovalId || transaction.approvalBindingId !== context.expectedApprovalBindingId) throw new InvalidTransitionError("ProofSpend application transaction evidence", from, to);
}

function requiredApprovalPolicy(operationType: NonNullable<TransactionRecord["arcTransaction"]>["operationType"]): { actionKind: ApprovalRecord["actionKind"]; actorType: "FOUNDER" | "PROVIDER" | "EVALUATOR" } | null {
  switch (operationType) {
    case "SETTLEMENT": case "REFUND": case "JOB_FUND":
      return { actionKind: "RELEASE_APPROVAL", actorType: "FOUNDER" };
    case "JOB_SUBMIT":
      return { actionKind: "JOB_SUBMISSION", actorType: "PROVIDER" };
    case "JOB_EVALUATE":
      return { actionKind: "JOB_EVALUATION", actorType: "EVALUATOR" };
    case "JOB_CREATE": case "IDENTITY_REGISTRATION": case "REPUTATION_WRITE":
      return null;
  }
  return null;
}
function assertFiniteTime(value: string | null): number | null {
  if (value === null) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
export async function transitionApplicationSubmission(context: TransitionContext) {
  const from = "PREPARED"; const to = "SUBMITTED";
  const authority = applicationAuthority[`${from}->${to}`] ?? { actorTypes: ["ADAPTER"], identifier: "authorizedAdapterId" as const };
  if (!authority.actorTypes.includes(context.actor.actorType) || context[authority.identifier] === undefined || context.actor.actorId !== context[authority.identifier]) throw new InvalidTransitionError("ProofSpend application authority", from, to);
  const transaction = TransactionRecordSchema.safeParse(context.submissionTransaction);
  const binding = ExecutionAuthorizationBindingSchema.safeParse(context.executionBinding);
  const approval = ApprovalRecordSchema.safeParse(context.approvalDecision);
  const submission = SubmissionOperationRecordSchema.safeParse(context.submissionOperation);
  if (!transaction.success || !binding.success || !approval.success || !submission.success) throw new InvalidTransitionError("ProofSpend application submission evidence", from, to);
  const arcTransaction = transaction.data.arcTransaction;
  const executionIntent = CanonicalExecutionIntentSchema.parse(binding.data.executionIntent);
  const policy = arcTransaction === null ? null : requiredApprovalPolicy(arcTransaction.operationType);
  const decidedAt = assertFiniteTime(approval.data.decidedAt);
  const occurredAt = assertFiniteTime(context.occurredAt);
  const expiresAt = assertFiniteTime(approval.data.expiresAt);
  const recomputedHash = await hashCanonicalExecutionIntent(executionIntent);
  const methodMatches = executionIntent.protocolTarget.kind !== "ERC8183" || (executionIntent.protocolTarget.method === executionIntent.operationType && executionIntent.protocolTarget.method === arcTransaction?.operationType);
  if (transaction.data.operationState !== "SUBMITTED" || arcTransaction?.status !== "SUBMITTED" || binding.data.status !== "CONSUMED" || binding.data.consumedAt === null || binding.data.consumedByTransactionId !== transaction.data.id || binding.data.transactionRecordId !== transaction.data.id || binding.data.releaseRequestId !== transaction.data.releaseRequestId || binding.data.intentId !== transaction.data.intentId || binding.data.approvalId !== transaction.data.approvalId || transaction.data.approvalBindingId !== binding.data.id || submission.data.transactionId !== transaction.data.id || context.idempotencyKey === undefined || submission.data.idempotencyKey !== context.idempotencyKey || context.aggregateId !== transaction.data.releaseRequestId || transaction.data.id !== context.expectedTransactionId || transaction.data.projectId !== context.expectedProjectId || transaction.data.releaseRequestId !== context.expectedReleaseRequestId || transaction.data.intentId !== context.expectedIntentId || transaction.data.approvalId !== context.expectedApprovalId || transaction.data.approvalBindingId !== context.expectedApprovalBindingId || approval.data.decision !== "APPROVED" || approval.data.id !== transaction.data.approvalId || approval.data.id !== binding.data.approvalId || approval.data.aggregateId !== context.aggregateId || approval.data.aggregateId !== transaction.data.releaseRequestId || approval.data.intentId !== transaction.data.intentId || approval.data.intentId !== binding.data.intentId || approval.data.intentId !== executionIntent.intentId || approval.data.approver === null || policy === null || executionIntent.actionKind !== policy.actionKind || approval.data.actionKind !== executionIntent.actionKind || approval.data.actionKind !== policy.actionKind || approval.data.authorizedActorType !== policy.actorType || approval.data.approver.actorType !== approval.data.authorizedActorType || approval.data.approver.actorId !== approval.data.authorizedActorId || decidedAt === null || occurredAt === null || expiresAt === null || decidedAt > occurredAt || occurredAt >= expiresAt || decidedAt > expiresAt || executionIntent.transactionRecordId !== transaction.data.id || executionIntent.projectId !== transaction.data.projectId || executionIntent.releaseRequestId !== transaction.data.releaseRequestId || executionIntent.asset !== transaction.data.amount.asset || executionIntent.atomicAmount !== transaction.data.amount.atomicUnits || executionIntent.operationType !== arcTransaction.operationType || !methodMatches || executionIntent.protocolTarget.destination !== transaction.data.destinationReference || executionIntent.protocolTarget.network !== arcTransaction.network || executionIntent.protocolTarget.chainId !== arcTransaction.chainId || recomputedHash !== approval.data.exactIntentHash || recomputedHash !== binding.data.exactIntentHash) throw new InvalidTransitionError("ProofSpend application submission evidence", from, to);
  return { state: to, auditEvent: event(context, from, to) } as const;
}

const immutableJobFieldsMatch = (current: AgenticJobRef, target: AgenticJobRef): boolean =>
  current.standard === target.standard &&
  current.network === target.network &&
  current.chainId === target.chainId &&
  current.contractAddress === target.contractAddress &&
  current.jobId === target.jobId &&
  current.clientAddress === target.clientAddress &&
  current.providerAddress === target.providerAddress &&
  current.evaluatorAddress === target.evaluatorAddress &&
  current.budget.asset === target.budget.asset &&
  current.budget.atomicUnits === target.budget.atomicUnits &&
  current.expiresAt === target.expiresAt &&
  current.descriptionReference === target.descriptionReference &&
  current.isMock === target.isMock;

const mutableJobEvidenceMatches = (current: AgenticJobRef, target: AgenticJobRef): boolean => {
  const currentTransaction = current.transaction;
  const targetTransaction = target.transaction;
  const transactionMatches = currentTransaction === null
    ? targetTransaction === null
    : targetTransaction !== null &&
      currentTransaction.network === targetTransaction.network &&
      currentTransaction.chainId === targetTransaction.chainId &&
      currentTransaction.transactionHash === targetTransaction.transactionHash &&
      currentTransaction.status === targetTransaction.status &&
      currentTransaction.blockNumber === targetTransaction.blockNumber &&
      currentTransaction.blockHash === targetTransaction.blockHash &&
      currentTransaction.explorerUrl === targetTransaction.explorerUrl &&
      currentTransaction.operationType === targetTransaction.operationType &&
      currentTransaction.isMock === targetTransaction.isMock;
  return current.deliverableReference === target.deliverableReference &&
    current.reasonReference === target.reasonReference &&
    transactionMatches;
};

function validateProviderSubmissionAuthorization(context: TransitionContext, target: AgenticJobRef, from: AgenticJobStatus, to: AgenticJobStatus): void {
  const approval = ApprovalRecordSchema.safeParse(context.jobApprovalDecision);
  const binding = ExecutionAuthorizationBindingSchema.safeParse(context.executionBinding);
  if (!approval.success || !binding.success || target.transaction === null) throw new InvalidTransitionError("agentic job provider submission authorization", from, to);
  const intent = binding.data.executionIntent;
  const protocolTarget = intent.protocolTarget;
  if (protocolTarget.kind !== "ERC8183") throw new InvalidTransitionError("agentic job provider submission authorization", from, to);
  const decidedAt = assertFiniteTime(approval.data.decidedAt);
  const consumedAt = assertFiniteTime(binding.data.consumedAt);
  const occurredAt = assertFiniteTime(context.occurredAt);
  const expiresAt = assertFiniteTime(approval.data.expiresAt);
  if (
    approval.data.actionKind !== "JOB_SUBMISSION" ||
    approval.data.authorizedActorType !== "PROVIDER" ||
    approval.data.authorizedActorId !== target.providerAddress ||
    approval.data.authorizedActorId !== context.authorizedProviderId ||
    approval.data.approver?.actorType !== "PROVIDER" ||
    approval.data.approver.actorId !== approval.data.authorizedActorId ||
    approval.data.aggregateId !== target.jobId ||
    approval.data.aggregateId !== context.aggregateId ||
    approval.data.decision !== "APPROVED" ||
    approval.data.id !== context.expectedApprovalId ||
    approval.data.id !== binding.data.approvalId ||
    approval.data.intentId !== context.expectedIntentId ||
    approval.data.intentId !== binding.data.intentId ||
    approval.data.exactIntentHash !== context.expectedExactIntentHash ||
    approval.data.exactIntentHash !== binding.data.exactIntentHash ||
    binding.data.id !== context.expectedApprovalBindingId ||
    binding.data.status !== "CONSUMED" ||
    binding.data.releaseRequestId !== target.jobId ||
    binding.data.releaseRequestId !== context.expectedReleaseRequestId ||
    binding.data.transactionRecordId !== context.expectedTransactionId ||
    binding.data.consumedByTransactionId !== context.expectedTransactionId ||
    decidedAt === null || consumedAt === null || occurredAt === null || expiresAt === null ||
    decidedAt > consumedAt || consumedAt > occurredAt || occurredAt >= expiresAt ||
    intent.actionKind !== "JOB_SUBMISSION" ||
    intent.projectId !== context.expectedProjectId ||
    intent.releaseRequestId !== target.jobId ||
    intent.transactionRecordId !== context.expectedTransactionId ||
    intent.intentId !== context.expectedIntentId ||
    intent.asset !== target.budget.asset ||
    intent.atomicAmount !== target.budget.atomicUnits ||
    intent.operationType !== "JOB_SUBMIT" ||
    protocolTarget.method !== "JOB_SUBMIT" ||
    protocolTarget.jobId !== target.jobId ||
    protocolTarget.contractReference !== target.contractAddress ||
    protocolTarget.clientReference !== target.clientAddress ||
    protocolTarget.providerReference !== target.providerAddress ||
    protocolTarget.evaluatorReference !== target.evaluatorAddress ||
    protocolTarget.destination !== target.providerAddress ||
    protocolTarget.network !== target.transaction.network ||
    protocolTarget.chainId !== target.transaction.chainId
  ) throw new InvalidTransitionError("agentic job provider submission authorization", from, to);
}


export function transitionAgenticJob(from: AgenticJobStatus, to: AgenticJobStatus, context: TransitionContext) {
  if (!jobTransitions[from].includes(to)) throw new InvalidTransitionError("agentic job", from, to);
  const authority = jobAuthority[`${from}->${to}`];
  if (authority === undefined || context.actor.actorType !== authority.actorType || context[authority.identifier] === undefined || context.actor.actorId !== context[authority.identifier]) throw new InvalidTransitionError("agentic job authority", from, to);
  if (to === "EXPIRED") {
    const current = AgenticJobRefSchema.safeParse(context.currentJobEvidence);
    const occurredAt = Date.parse(context.occurredAt);
    if (!current.success || !current.data.isMock || current.data.jobId !== context.aggregateId || current.data.status !== from || !Number.isFinite(occurredAt) || occurredAt < Date.parse(current.data.expiresAt)) throw new InvalidTransitionError("agentic job expiry evidence", from, to);
    const target = AgenticJobRefSchema.safeParse(context.jobEvidence ?? { ...current.data, status: to });
    if (!target.success || !target.data.isMock || target.data.jobId !== context.aggregateId || target.data.status !== to || !immutableJobFieldsMatch(current.data, target.data) || !mutableJobEvidenceMatches(current.data, target.data)) throw new InvalidTransitionError("agentic job expiry evidence", from, to);
    return { status: to, auditEvent: event(context, from, to) } as const;
  }
  const current = AgenticJobRefSchema.safeParse(context.currentJobEvidence);
  const target = AgenticJobRefSchema.safeParse(context.jobEvidence);
  if (!current.success || !target.success || !current.data.isMock || !target.data.isMock || current.data.jobId !== context.aggregateId || target.data.jobId !== context.aggregateId || current.data.status !== from || target.data.status !== to || !immutableJobFieldsMatch(current.data, target.data)) throw new InvalidTransitionError("agentic job lifecycle evidence", from, to);
  if (to === "FUNDED" && (target.data.deliverableReference !== null || target.data.reasonReference !== null || target.data.transaction?.isMock !== true || target.data.transaction.status !== "CONFIRMED" || target.data.transaction.operationType !== "JOB_FUND")) throw new InvalidTransitionError("agentic job funding evidence", from, to);
  if (to === "SUBMITTED") {
    if (target.data.deliverableReference === null || target.data.reasonReference !== null || target.data.transaction?.isMock !== true || !["SUBMITTED", "CONFIRMED"].includes(target.data.transaction.status) || target.data.transaction.operationType !== "JOB_SUBMIT") throw new InvalidTransitionError("agentic job submission evidence", from, to);
    validateProviderSubmissionAuthorization(context, target.data, from, to);
  }
  if (to === "COMPLETED" || to === "REJECTED") {
    const approval = ApprovalRecordSchema.safeParse(context.jobApprovalDecision);
    const decision = to === "COMPLETED" ? "APPROVED" : "REJECTED";
    const transaction = target.data.transaction;
    const evaluationEvidence = JobEvaluationEvidenceSchema.safeParse(context.jobEvaluationEvidence);
    const decidedAt = approval.success ? assertFiniteTime(approval.data.decidedAt) : null;
    const occurredAt = assertFiniteTime(context.occurredAt);
    const expiresAt = approval.success ? assertFiniteTime(approval.data.expiresAt) : null;
    const deliverablePreserved = current.data.deliverableReference !== null && target.data.deliverableReference === current.data.deliverableReference;
    const terminalFieldsValid = to === "COMPLETED" ? target.data.reasonReference === null : target.data.reasonReference !== null;
    const providerSubmission = current.data.transaction;
    const providerSubmissionConfirmed = providerSubmission?.operationType === "JOB_SUBMIT" && providerSubmission.status === "CONFIRMED" && providerSubmission.transactionHash !== null && providerSubmission.blockNumber !== null && providerSubmission.blockHash !== null;
    if (!approval.success || !evaluationEvidence.success || !providerSubmissionConfirmed || !deliverablePreserved || !terminalFieldsValid || approval.data.actionKind !== "JOB_EVALUATION" || approval.data.aggregateId !== target.data.jobId || approval.data.aggregateId !== context.aggregateId || approval.data.decision !== decision || approval.data.approver?.actorType !== "EVALUATOR" || approval.data.approver.actorId !== context.actor.actorId || approval.data.authorizedActorId !== context.authorizedEvaluatorId || decidedAt === null || occurredAt === null || expiresAt === null || decidedAt > occurredAt || occurredAt >= expiresAt || transaction === null || transaction.status !== "CONFIRMED" || transaction.operationType !== "JOB_EVALUATE" || transaction.transactionHash === null || evaluationEvidence.data.jobId !== target.data.jobId || evaluationEvidence.data.approvalId !== approval.data.id || evaluationEvidence.data.intentId !== approval.data.intentId || evaluationEvidence.data.exactIntentHash !== approval.data.exactIntentHash || evaluationEvidence.data.decision !== decision || evaluationEvidence.data.transactionHash !== transaction.transactionHash || evaluationEvidence.data.transactionNetwork !== transaction.network || evaluationEvidence.data.transactionChainId !== transaction.chainId) throw new InvalidTransitionError("agentic job evaluation evidence", from, to);
  }
  return { status: to, auditEvent: event(context, from, to) } as const;
}
export function mapAgenticJobToApplication(status: AgenticJobStatus): ProofSpendApplicationState | null {
  if (status === "REJECTED" || status === "EXPIRED") return "REJECTED";
  return null;
}
