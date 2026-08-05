import { AgenticJobRefSchema, ApprovalRecordSchema, CanonicalExecutionIntentSchema, ExecutionAuthorizationBindingSchema, JobEvaluationEvidenceSchema, JobRefundOperationRecordSchema, ReconciliationRecordSchema, ReleaseRequestSchema, SettlementRecordSchema, SubmissionOperationRecordSchema, TransactionRecordSchema, type Actor, type AgenticJobRef, type AgenticJobStatus, type ApprovalRecord, type AuditEvent, type ExecutionAuthorizationBinding, type JobEvaluationEvidence, type JobRefundOperationRecord, type ReconciliationRecord, type ReleaseRequest, type SettlementRecord, type SubmissionOperationRecord, type TransactionRecord } from "./models";
import { hashCanonicalExecutionIntent, hashJobParameterCommitment, validateReconciliation } from "./integrity";

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
  OPEN: ["FUNDED", "REJECTED"], FUNDED: ["SUBMITTED", "REJECTED", "EXPIRED"], SUBMITTED: ["COMPLETED", "REJECTED", "EXPIRED"],
  COMPLETED: [], REJECTED: [], EXPIRED: [],
};
export interface TransitionContext {
  aggregateType: string; aggregateId: string; eventId: string; occurredAt: string; actor: Actor;
  authorizedSystemId?: string; authorizedApproverId?: string; authorizedAdapterId?: string; authorizedProviderId?: string; authorizedEvaluatorId?: string; idempotencyKey?: string;
  confirmationTransaction?: TransactionRecord; expectedTransactionId?: string; expectedProjectId?: string; expectedReleaseRequestId?: string; expectedOperationType?: NonNullable<TransactionRecord["arcTransaction"]>["operationType"];
  expectedIntentId?: string; expectedApprovalId?: string; expectedApprovalBindingId?: string; expectedExactIntentHash?: string;
  currentReleaseRequest?: ReleaseRequest; submissionTransaction?: TransactionRecord; executionBinding?: ExecutionAuthorizationBinding; submissionOperation?: SubmissionOperationRecord;
  reconciliationTransaction?: TransactionRecord; reconciliationSettlement?: SettlementRecord; reconciliationRecord?: ReconciliationRecord;
  approvalDecision?: ApprovalRecord; lifecycleTransaction?: TransactionRecord;
  jobEvidence?: AgenticJobRef; currentJobEvidence?: AgenticJobRef; jobApprovalDecision?: ApprovalRecord;
  jobEvaluationEvidence?: JobEvaluationEvidence; jobRefundOperation?: JobRefundOperationRecord;
}
type ApplicationEdge = `${ProofSpendApplicationState}->${ProofSpendApplicationState}`;
type AuthorityRule = { actorTypes: readonly Actor["actorType"][]; identifier: "authorizedSystemId" | "authorizedApproverId" | "authorizedAdapterId" };
type ApplicationApprovalPolicy = { actionKind: "RELEASE_APPROVAL" | "MILESTONE_EVALUATION"; actorType: "FOUNDER" | "EVALUATOR" };
const applicationApprovalPolicy: Readonly<Record<"release" | "milestone", ApplicationApprovalPolicy>> = {
  release: { actionKind: "RELEASE_APPROVAL", actorType: "FOUNDER" },
  milestone: { actionKind: "MILESTONE_EVALUATION", actorType: "EVALUATOR" },
};
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
type JobAuthorityRule = { actorType: "ADAPTER" | "SYSTEM"; identifier: "authorizedAdapterId" | "authorizedSystemId" };
const jobAuthority: Partial<Record<JobEdge, JobAuthorityRule>> = {
  "OPEN->FUNDED": { actorType: "ADAPTER", identifier: "authorizedAdapterId" },
  "OPEN->REJECTED": { actorType: "ADAPTER", identifier: "authorizedAdapterId" },
  "FUNDED->SUBMITTED": { actorType: "ADAPTER", identifier: "authorizedAdapterId" },
  "FUNDED->REJECTED": { actorType: "ADAPTER", identifier: "authorizedAdapterId" },
  "SUBMITTED->COMPLETED": { actorType: "ADAPTER", identifier: "authorizedAdapterId" },
  "SUBMITTED->REJECTED": { actorType: "ADAPTER", identifier: "authorizedAdapterId" },
   "FUNDED->EXPIRED": { actorType: "ADAPTER", identifier: "authorizedAdapterId" },
  "SUBMITTED->EXPIRED": { actorType: "ADAPTER", identifier: "authorizedAdapterId" },
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
    const policy = context.aggregateType === "release"
      ? applicationApprovalPolicy.release
      : context.aggregateType === "milestone"
        ? applicationApprovalPolicy.milestone
        : null;
    const decidedAt = approval.success ? assertFiniteTime(approval.data.decidedAt) : null;
    const occurredAt = assertFiniteTime(context.occurredAt);
    const expiresAt = approval.success ? assertFiniteTime(approval.data.expiresAt) : null;
    if (!approval.success || policy === null || approval.data.actionKind !== policy.actionKind || approval.data.authorizedActorType !== policy.actorType || approval.data.aggregateId !== context.aggregateId || approval.data.intentId !== context.expectedIntentId || approval.data.id !== context.expectedApprovalId || approval.data.exactIntentHash !== context.expectedExactIntentHash || approval.data.decision !== expectedDecision || approval.data.approver === null || approval.data.decidedAt === null || approval.data.approver.actorType !== approval.data.authorizedActorType || approval.data.approver.actorId !== approval.data.authorizedActorId || context.actor.actorType !== approval.data.approver.actorType || context.actor.actorId !== approval.data.approver.actorId || decidedAt === null || occurredAt === null || expiresAt === null || decidedAt > occurredAt || occurredAt >= expiresAt) throw new InvalidTransitionError("ProofSpend application approval evidence", from, to);
  }
  if (from === "APPROVED" && to === "PREPARED") validateLifecycleTransaction(context, "PREPARED", from, to);
  if ((from === "PREPARED" || from === "SUBMITTED") && to === "FAILED") validateLifecycleTransaction(context, "FAILED", from, to);
  if (from === "SUBMITTED" && to === "CONFIRMED") {
    const release = ReleaseRequestSchema.safeParse(context.currentReleaseRequest);
    const submitted = TransactionRecordSchema.safeParse(context.submissionTransaction);
    const confirmed = TransactionRecordSchema.safeParse(context.confirmationTransaction);
    const transaction = confirmed.success ? confirmed.data : null;
    const submittedTransaction = submitted.success ? submitted.data : null;
    if (!release.success || transaction === null || submittedTransaction === null || release.data.state !== "SUBMITTED" || submittedTransaction.operationState !== "SUBMITTED" || submittedTransaction.arcTransaction?.status !== "SUBMITTED" || transaction.operationState !== "CONFIRMED" || transaction.arcTransaction?.status !== "CONFIRMED" || context.expectedTransactionId === undefined || context.expectedProjectId === undefined || context.expectedReleaseRequestId === undefined || context.expectedIntentId === undefined || context.expectedApprovalId === undefined || context.expectedApprovalBindingId === undefined || context.aggregateId !== release.data.id || context.aggregateId !== transaction.releaseRequestId || transaction.id !== context.expectedTransactionId || transaction.projectId !== context.expectedProjectId || transaction.releaseRequestId !== context.expectedReleaseRequestId || transaction.intentId !== context.expectedIntentId || transaction.approvalId !== context.expectedApprovalId || transaction.approvalBindingId !== context.expectedApprovalBindingId || submittedTransaction.id !== transaction.id || submittedTransaction.projectId !== transaction.projectId || submittedTransaction.releaseRequestId !== transaction.releaseRequestId || submittedTransaction.intentId !== transaction.intentId || submittedTransaction.approvalId !== transaction.approvalId || submittedTransaction.approvalBindingId !== transaction.approvalBindingId || release.data.projectId !== transaction.projectId || release.data.intentId !== transaction.intentId || release.data.approvalId !== transaction.approvalId || release.data.amount.asset !== transaction.amount.asset || release.data.amount.atomicUnits !== transaction.amount.atomicUnits || submittedTransaction.amount.asset !== transaction.amount.asset || submittedTransaction.amount.atomicUnits !== transaction.amount.atomicUnits || submittedTransaction.destinationReference !== transaction.destinationReference || submittedTransaction.arcTransaction.transactionHash !== transaction.arcTransaction.transactionHash || submittedTransaction.arcTransaction.network !== transaction.arcTransaction.network || submittedTransaction.arcTransaction.chainId !== transaction.arcTransaction.chainId || submittedTransaction.arcTransaction.isMock !== transaction.arcTransaction.isMock || (context.expectedOperationType !== "SETTLEMENT" && context.expectedOperationType !== "REFUND" && context.expectedOperationType !== "JOB_EVALUATE") || submittedTransaction.arcTransaction.operationType !== context.expectedOperationType || transaction.arcTransaction.operationType !== context.expectedOperationType) throw new InvalidTransitionError("ProofSpend application confirmation evidence", from, to);
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

function requiredApprovalPolicy(operationType: NonNullable<TransactionRecord["arcTransaction"]>["operationType"]): { actionKind: "RELEASE_APPROVAL"; actorType: "FOUNDER" } | null {
  if (operationType === "SETTLEMENT" || operationType === "REFUND") return { actionKind: "RELEASE_APPROVAL", actorType: "FOUNDER" };
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
  const release = ReleaseRequestSchema.safeParse(context.currentReleaseRequest);
  const transaction = TransactionRecordSchema.safeParse(context.submissionTransaction);
  const binding = ExecutionAuthorizationBindingSchema.safeParse(context.executionBinding);
  const approval = ApprovalRecordSchema.safeParse(context.approvalDecision);
  const submission = SubmissionOperationRecordSchema.safeParse(context.submissionOperation);
  if (!release.success || !transaction.success || !binding.success || !approval.success || !submission.success) throw new InvalidTransitionError("ProofSpend application submission evidence", from, to);
  const arcTransaction = transaction.data.arcTransaction;
  const executionIntent = CanonicalExecutionIntentSchema.parse(binding.data.executionIntent);
  const policy = arcTransaction === null ? null : requiredApprovalPolicy(arcTransaction.operationType);
  const decidedAt = assertFiniteTime(approval.data.decidedAt);
  const consumedAt = assertFiniteTime(binding.data.consumedAt);
  const occurredAt = assertFiniteTime(context.occurredAt);
  const expiresAt = assertFiniteTime(approval.data.expiresAt);
  const recomputedHash = await hashCanonicalExecutionIntent(executionIntent);
  const targetModeMatches = executionIntent.protocolTarget.kind === "DESTINATION" && executionIntent.protocolTarget.isMock === arcTransaction?.isMock;
  if (release.data.state !== "PREPARED" || release.data.id !== context.aggregateId || release.data.id !== transaction.data.releaseRequestId || release.data.projectId !== transaction.data.projectId || release.data.intentId !== transaction.data.intentId || release.data.approvalId !== transaction.data.approvalId || release.data.amount.asset !== transaction.data.amount.asset || release.data.amount.atomicUnits !== transaction.data.amount.atomicUnits || transaction.data.operationState !== "SUBMITTED" || arcTransaction?.status !== "SUBMITTED" || binding.data.status !== "CONSUMED" || binding.data.consumedAt === null || binding.data.consumedByTransactionId !== transaction.data.id || binding.data.transactionRecordId !== transaction.data.id || binding.data.releaseRequestId !== transaction.data.releaseRequestId || binding.data.intentId !== transaction.data.intentId || binding.data.approvalId !== transaction.data.approvalId || transaction.data.approvalBindingId !== binding.data.id || submission.data.transactionId !== transaction.data.id || context.idempotencyKey === undefined || submission.data.idempotencyKey !== context.idempotencyKey || submission.data.arcTransaction.transactionHash !== arcTransaction.transactionHash || submission.data.arcTransaction.network !== arcTransaction.network || submission.data.arcTransaction.chainId !== arcTransaction.chainId || submission.data.arcTransaction.isMock !== arcTransaction.isMock || submission.data.arcTransaction.operationType !== arcTransaction.operationType || submission.data.arcTransaction.status !== arcTransaction.status || context.aggregateId !== transaction.data.releaseRequestId || transaction.data.id !== context.expectedTransactionId || transaction.data.projectId !== context.expectedProjectId || transaction.data.releaseRequestId !== context.expectedReleaseRequestId || transaction.data.intentId !== context.expectedIntentId || transaction.data.approvalId !== context.expectedApprovalId || transaction.data.approvalBindingId !== context.expectedApprovalBindingId || approval.data.decision !== "APPROVED" || approval.data.id !== transaction.data.approvalId || approval.data.id !== binding.data.approvalId || approval.data.aggregateId !== context.aggregateId || approval.data.aggregateId !== transaction.data.releaseRequestId || approval.data.intentId !== transaction.data.intentId || approval.data.intentId !== binding.data.intentId || approval.data.intentId !== executionIntent.intentId || approval.data.approver === null || policy === null || executionIntent.actionKind !== policy.actionKind || approval.data.actionKind !== executionIntent.actionKind || approval.data.actionKind !== policy.actionKind || approval.data.authorizedActorType !== policy.actorType || approval.data.approver.actorType !== approval.data.authorizedActorType || approval.data.approver.actorId !== approval.data.authorizedActorId || context.authorizedApproverId === undefined || approval.data.authorizedActorId !== context.authorizedApproverId || approval.data.approver.actorId !== context.authorizedApproverId || decidedAt === null || consumedAt === null || occurredAt === null || expiresAt === null || decidedAt > consumedAt || consumedAt > occurredAt || occurredAt >= expiresAt || decidedAt > expiresAt || executionIntent.transactionRecordId !== transaction.data.id || executionIntent.projectId !== transaction.data.projectId || executionIntent.releaseRequestId !== transaction.data.releaseRequestId || executionIntent.asset !== transaction.data.amount.asset || executionIntent.atomicAmount !== transaction.data.amount.atomicUnits || executionIntent.operationType !== arcTransaction.operationType || !targetModeMatches || executionIntent.protocolTarget.destination !== transaction.data.destinationReference || executionIntent.protocolTarget.network !== arcTransaction.network || executionIntent.protocolTarget.chainId !== arcTransaction.chainId || context.expectedExactIntentHash === undefined || recomputedHash !== context.expectedExactIntentHash || recomputedHash !== approval.data.exactIntentHash || recomputedHash !== binding.data.exactIntentHash) throw new InvalidTransitionError("ProofSpend application submission evidence", from, to);
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

const arcTransactionEvidenceMatches = (left: NonNullable<AgenticJobRef["transaction"]>, right: NonNullable<AgenticJobRef["transaction"]>): boolean =>
  left.network === right.network &&
  left.chainId === right.chainId &&
  left.transactionHash === right.transactionHash &&
  left.status === right.status &&
  left.blockNumber === right.blockNumber &&
  left.blockHash === right.blockHash &&
  left.explorerUrl === right.explorerUrl &&
  left.operationType === right.operationType &&
  left.isMock === right.isMock;

async function validateJobExecutionAuthorization(context: TransitionContext, target: AgenticJobRef, from: AgenticJobStatus, to: AgenticJobStatus, policy: {
  actionKind: "RELEASE_APPROVAL" | "JOB_SUBMISSION" | "JOB_EVALUATION" | "JOB_REJECTION";
  actorType: "FOUNDER" | "PROVIDER" | "EVALUATOR";
  actorId: string;
  authorizedActorId: string | undefined;
  outcomeDecision: "APPROVED" | "REJECTED" | null;
  operationType: "JOB_FUND" | "JOB_SUBMIT" | "JOB_EVALUATE" | "JOB_REJECT";
}): Promise<ApprovalRecord> {
  const approval = ApprovalRecordSchema.safeParse(context.jobApprovalDecision);
  const binding = ExecutionAuthorizationBindingSchema.safeParse(context.executionBinding);
  const submission = SubmissionOperationRecordSchema.safeParse(context.submissionOperation);
  if (!approval.success || !binding.success || !submission.success || target.transaction === null || context.idempotencyKey === undefined) throw new InvalidTransitionError("agentic job execution authorization", from, to);
  const intent = binding.data.executionIntent;
  const protocolTarget = intent.protocolTarget;
  if (protocolTarget.kind !== "ERC8183") throw new InvalidTransitionError("agentic job execution authorization", from, to);
  const decidedAt = assertFiniteTime(approval.data.decidedAt);
  const consumedAt = assertFiniteTime(binding.data.consumedAt);
  const submittedAt = assertFiniteTime(submission.data.createdAt);
  const occurredAt = assertFiniteTime(context.occurredAt);
  const expiresAt = assertFiniteTime(approval.data.expiresAt);
  const recomputedHash = await hashCanonicalExecutionIntent(intent);
  const isDecisionOperation = policy.operationType === "JOB_EVALUATE" || policy.operationType === "JOB_REJECT";
  const parameterCommitment = await hashJobParameterCommitment({ operationType: policy.operationType, jobId: target.jobId, asset: target.budget.asset, atomicAmount: target.budget.atomicUnits, deliverableReference: policy.operationType === "JOB_FUND" ? null : target.deliverableReference, decision: isDecisionOperation ? policy.outcomeDecision : null, reasonReference: isDecisionOperation ? target.reasonReference : null });
  if (
    approval.data.actionKind !== policy.actionKind ||
    approval.data.authorizedActorType !== policy.actorType ||
    approval.data.authorizedActorId !== policy.actorId ||
    approval.data.authorizedActorId !== policy.authorizedActorId ||
    approval.data.approver?.actorType !== policy.actorType ||
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
    approval.data.exactIntentHash !== recomputedHash ||
    binding.data.id !== context.expectedApprovalBindingId ||
    binding.data.status !== "CONSUMED" ||
    binding.data.releaseRequestId !== target.jobId ||
    binding.data.releaseRequestId !== context.expectedReleaseRequestId ||
    binding.data.transactionRecordId !== context.expectedTransactionId ||
    binding.data.consumedByTransactionId !== context.expectedTransactionId ||
    submission.data.transactionId !== context.expectedTransactionId ||
    submission.data.transactionId !== binding.data.transactionRecordId ||
    submission.data.idempotencyKey !== context.idempotencyKey ||
    submission.data.arcTransaction.status !== target.transaction.status ||
    submission.data.arcTransaction.transactionHash !== target.transaction.transactionHash ||
    submission.data.arcTransaction.network !== target.transaction.network ||
    submission.data.arcTransaction.chainId !== target.transaction.chainId ||
    submission.data.arcTransaction.isMock !== target.transaction.isMock ||
    submission.data.arcTransaction.operationType !== target.transaction.operationType ||
    submission.data.arcTransaction.blockNumber !== target.transaction.blockNumber ||
    submission.data.arcTransaction.blockHash !== target.transaction.blockHash ||
    submission.data.arcTransaction.explorerUrl !== target.transaction.explorerUrl ||
    decidedAt === null || consumedAt === null || submittedAt === null || occurredAt === null || expiresAt === null ||
    decidedAt > consumedAt || consumedAt > submittedAt || submittedAt > occurredAt || occurredAt >= expiresAt ||
    intent.actionKind !== policy.actionKind ||
    intent.projectId !== context.expectedProjectId ||
    intent.releaseRequestId !== target.jobId ||
    intent.transactionRecordId !== context.expectedTransactionId ||
    intent.intentId !== context.expectedIntentId ||
    intent.asset !== target.budget.asset ||
    intent.atomicAmount !== target.budget.atomicUnits ||
    intent.operationType !== policy.operationType ||
    protocolTarget.method !== policy.operationType ||
    protocolTarget.parameterCommitment !== parameterCommitment ||
    protocolTarget.jobId !== target.jobId ||
    protocolTarget.contractReference !== target.contractAddress ||
    protocolTarget.clientReference !== target.clientAddress ||
    protocolTarget.providerReference !== target.providerAddress ||
    protocolTarget.evaluatorReference !== target.evaluatorAddress ||
    protocolTarget.destination !== target.contractAddress ||
    protocolTarget.network !== target.transaction.network ||
    protocolTarget.chainId !== target.transaction.chainId
  ) throw new InvalidTransitionError("agentic job execution authorization", from, to);
  return approval.data;
}

async function validateJobRefundAuthorization(context: TransitionContext, target: AgenticJobRef, refund: JobRefundOperationRecord, from: AgenticJobStatus, to: AgenticJobStatus): Promise<void> {
  const approval = ApprovalRecordSchema.safeParse(context.jobApprovalDecision);
  const binding = ExecutionAuthorizationBindingSchema.safeParse(context.executionBinding);
  const targetTransaction = target.transaction;
  if (!approval.success || !binding.success || targetTransaction === null || context.idempotencyKey === undefined) throw new InvalidTransitionError("agentic job refund authorization", from, to);
  const intent = binding.data.executionIntent;
  const protocolTarget = intent.protocolTarget;
  if (protocolTarget.kind !== "DESTINATION") throw new InvalidTransitionError("agentic job refund authorization", from, to);
  const decidedAt = assertFiniteTime(approval.data.decidedAt);
  const consumedAt = assertFiniteTime(binding.data.consumedAt);
  const refundedAt = assertFiniteTime(refund.createdAt);
  const occurredAt = assertFiniteTime(context.occurredAt);
  const approvalExpiresAt = assertFiniteTime(approval.data.expiresAt);
  const recomputedHash = await hashCanonicalExecutionIntent(intent);
  if (
    approval.data.actionKind !== "RELEASE_APPROVAL" ||
    approval.data.authorizedActorType !== "FOUNDER" ||
    approval.data.authorizedActorId !== target.clientAddress ||
    approval.data.authorizedActorId !== context.authorizedApproverId ||
    approval.data.approver?.actorType !== "FOUNDER" ||
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
    approval.data.exactIntentHash !== recomputedHash ||
    binding.data.id !== context.expectedApprovalBindingId ||
    binding.data.status !== "CONSUMED" ||
    binding.data.releaseRequestId !== target.jobId ||
    binding.data.releaseRequestId !== context.expectedReleaseRequestId ||
    binding.data.transactionRecordId !== context.expectedTransactionId ||
    binding.data.consumedByTransactionId !== context.expectedTransactionId ||
    refund.transactionId !== context.expectedTransactionId ||
    refund.transactionId !== binding.data.transactionRecordId ||
    refund.idempotencyKey !== context.idempotencyKey ||
    !arcTransactionEvidenceMatches(refund.arcTransaction, targetTransaction) ||
    decidedAt === null || consumedAt === null || refundedAt === null || occurredAt === null || approvalExpiresAt === null ||
    decidedAt > consumedAt || consumedAt > refundedAt || refundedAt > occurredAt || occurredAt >= approvalExpiresAt ||
    intent.actionKind !== "RELEASE_APPROVAL" ||
    intent.projectId !== context.expectedProjectId ||
    intent.releaseRequestId !== target.jobId ||
    intent.transactionRecordId !== context.expectedTransactionId ||
    intent.intentId !== context.expectedIntentId ||
    intent.asset !== target.budget.asset ||
    intent.atomicAmount !== target.budget.atomicUnits ||
    intent.operationType !== "REFUND" ||
    protocolTarget.destination !== target.clientAddress ||
    protocolTarget.network !== targetTransaction.network ||
    protocolTarget.chainId !== targetTransaction.chainId ||
    protocolTarget.isMock !== targetTransaction.isMock
  ) throw new InvalidTransitionError("agentic job refund authorization", from, to);
}


export async function transitionAgenticJob(from: AgenticJobStatus, to: AgenticJobStatus, context: TransitionContext) {
  if (!jobTransitions[from].includes(to)) throw new InvalidTransitionError("agentic job", from, to);
  const authority = jobAuthority[`${from}->${to}`];
  if (authority === undefined || context.actor.actorType !== authority.actorType || context[authority.identifier] === undefined || context.actor.actorId !== context[authority.identifier]) throw new InvalidTransitionError("agentic job authority", from, to);
  if (to === "EXPIRED") {
    const current = AgenticJobRefSchema.safeParse(context.currentJobEvidence);
    const target = AgenticJobRefSchema.safeParse(context.jobEvidence);
    const refund = JobRefundOperationRecordSchema.safeParse(context.jobRefundOperation);
    const occurredAt = Date.parse(context.occurredAt);
    const expiresAt = current.success ? Date.parse(current.data.expiresAt) : Number.NaN;
    const refundedAt = refund.success ? Date.parse(refund.data.createdAt) : Number.NaN;
    const targetTransaction = target.success ? target.data.transaction : null;
    const priorTransaction = current.success ? current.data.transaction : null;
    const escrowTransaction = target.success ? target.data.escrowTransaction : null;
    if (
      !current.success || !target.success || !refund.success ||
      !current.data.isMock || !target.data.isMock ||
      current.data.jobId !== context.aggregateId || target.data.jobId !== context.aggregateId || refund.data.jobId !== context.aggregateId ||
      current.data.status !== from || target.data.status !== to ||
      !immutableJobFieldsMatch(current.data, target.data) ||
      target.data.deliverableReference !== current.data.deliverableReference || target.data.reasonReference !== null ||
      priorTransaction === null || escrowTransaction === null || !arcTransactionEvidenceMatches(priorTransaction, escrowTransaction) ||
      targetTransaction === null || !arcTransactionEvidenceMatches(refund.data.arcTransaction, targetTransaction) ||
      context.idempotencyKey === undefined || refund.data.idempotencyKey !== context.idempotencyKey ||
      context.expectedTransactionId === undefined || refund.data.transactionId !== context.expectedTransactionId ||
      !Number.isFinite(occurredAt) || !Number.isFinite(expiresAt) || !Number.isFinite(refundedAt) ||
      occurredAt < expiresAt || refundedAt < expiresAt || refundedAt > occurredAt
    ) throw new InvalidTransitionError("agentic job expiry evidence", from, to);
    await validateJobRefundAuthorization(context, target.data, refund.data, from, to);
    return { status: to, auditEvent: event(context, from, to) } as const;
  }
  const current = AgenticJobRefSchema.safeParse(context.currentJobEvidence);
  const target = AgenticJobRefSchema.safeParse(context.jobEvidence);
  if (!current.success || !target.success || !current.data.isMock || !target.data.isMock || current.data.jobId !== context.aggregateId || target.data.jobId !== context.aggregateId || current.data.status !== from || target.data.status !== to || !immutableJobFieldsMatch(current.data, target.data)) throw new InvalidTransitionError("agentic job lifecycle evidence", from, to);
  const occurredAt = Date.parse(context.occurredAt);
  const expiresAt = Date.parse(current.data.expiresAt);
  if (!Number.isFinite(occurredAt) || !Number.isFinite(expiresAt) || occurredAt >= expiresAt) throw new InvalidTransitionError("agentic job expiry gate", from, to);
  if (to === "FUNDED") {
    if (target.data.deliverableReference !== null || target.data.reasonReference !== null || target.data.transaction?.isMock !== true || target.data.transaction.status !== "CONFIRMED" || target.data.transaction.operationType !== "JOB_FUND") throw new InvalidTransitionError("agentic job funding evidence", from, to);
    await validateJobExecutionAuthorization(context, target.data, from, to, { actionKind: "RELEASE_APPROVAL", actorType: "FOUNDER", actorId: target.data.clientAddress, authorizedActorId: context.authorizedApproverId, outcomeDecision: null, operationType: "JOB_FUND" });
  }
  if (to === "SUBMITTED") {
    const fundingTransaction = current.data.transaction;
    if (current.data.deliverableReference !== null || current.data.reasonReference !== null || fundingTransaction?.isMock !== true || fundingTransaction.status !== "CONFIRMED" || fundingTransaction.operationType !== "JOB_FUND" || fundingTransaction.transactionHash === null || fundingTransaction.blockNumber === null || fundingTransaction.blockHash === null || target.data.deliverableReference === null || target.data.reasonReference !== null || target.data.transaction?.isMock !== true || target.data.transaction.status !== "CONFIRMED" || target.data.transaction.operationType !== "JOB_SUBMIT") throw new InvalidTransitionError("agentic job submission evidence", from, to);
    await validateJobExecutionAuthorization(context, target.data, from, to, { actionKind: "JOB_SUBMISSION", actorType: "PROVIDER", actorId: target.data.providerAddress, authorizedActorId: context.authorizedProviderId, outcomeDecision: null, operationType: "JOB_SUBMIT" });
  }
  if (to === "COMPLETED") {
    const approval = await validateJobExecutionAuthorization(context, target.data, from, to, { actionKind: "JOB_EVALUATION", actorType: "EVALUATOR", actorId: target.data.evaluatorAddress, authorizedActorId: context.authorizedEvaluatorId, outcomeDecision: "APPROVED", operationType: "JOB_EVALUATE" });
    const transaction = target.data.transaction;
    const evaluationEvidence = JobEvaluationEvidenceSchema.safeParse(context.jobEvaluationEvidence);
    const deliverablePreserved = current.data.deliverableReference !== null && target.data.deliverableReference === current.data.deliverableReference;
    const providerSubmission = current.data.transaction;
    const providerSubmissionConfirmed = providerSubmission?.operationType === "JOB_SUBMIT" && providerSubmission.status === "CONFIRMED" && providerSubmission.transactionHash !== null && providerSubmission.blockNumber !== null && providerSubmission.blockHash !== null;
    if (!evaluationEvidence.success || !providerSubmissionConfirmed || !deliverablePreserved || approval.approver?.actorType !== "EVALUATOR" || approval.authorizedActorId !== target.data.evaluatorAddress || transaction === null || transaction.status !== "CONFIRMED" || transaction.operationType !== "JOB_EVALUATE" || transaction.transactionHash === null || evaluationEvidence.data.jobId !== target.data.jobId || evaluationEvidence.data.approvalId !== approval.id || evaluationEvidence.data.intentId !== approval.intentId || evaluationEvidence.data.exactIntentHash !== approval.exactIntentHash || evaluationEvidence.data.decision !== "APPROVED" || evaluationEvidence.data.transactionHash !== transaction.transactionHash || evaluationEvidence.data.transactionNetwork !== transaction.network || evaluationEvidence.data.transactionChainId !== transaction.chainId) throw new InvalidTransitionError("agentic job evaluation evidence", from, to);
  }
  if (to === "REJECTED") {
    const evaluatorRejection = from !== "OPEN";
    const approval = await validateJobExecutionAuthorization(context, target.data, from, to, {
      actionKind: "JOB_REJECTION",
      actorType: evaluatorRejection ? "EVALUATOR" : "FOUNDER",
      actorId: evaluatorRejection ? target.data.evaluatorAddress : target.data.clientAddress,
      authorizedActorId: evaluatorRejection ? context.authorizedEvaluatorId : context.authorizedApproverId,
      outcomeDecision: "REJECTED",
      operationType: "JOB_REJECT",
    });
    const transaction = target.data.transaction;
    const priorTransaction = current.data.transaction;
    const escrowTransaction = target.data.escrowTransaction;
    const deliverablePreserved = target.data.deliverableReference === current.data.deliverableReference;
    const priorStateEvidenceValid =
      (from === "OPEN" && current.data.deliverableReference === null && current.data.reasonReference === null && priorTransaction === null && escrowTransaction === null) ||
      (from === "FUNDED" && current.data.deliverableReference === null && current.data.reasonReference === null && priorTransaction?.operationType === "JOB_FUND" && priorTransaction.status === "CONFIRMED" && priorTransaction.transactionHash !== null && priorTransaction.blockNumber !== null && priorTransaction.blockHash !== null && escrowTransaction !== null && arcTransactionEvidenceMatches(priorTransaction, escrowTransaction)) ||
      (from === "SUBMITTED" && current.data.deliverableReference !== null && current.data.reasonReference === null && priorTransaction?.operationType === "JOB_SUBMIT" && priorTransaction.status === "CONFIRMED" && priorTransaction.transactionHash !== null && priorTransaction.blockNumber !== null && priorTransaction.blockHash !== null && escrowTransaction !== null && arcTransactionEvidenceMatches(priorTransaction, escrowTransaction));
    if (!priorStateEvidenceValid || !deliverablePreserved || transaction === null || transaction.status !== "CONFIRMED" || transaction.operationType !== "JOB_REJECT" || transaction.transactionHash === null) throw new InvalidTransitionError("agentic job rejection evidence", from, to);
    if (evaluatorRejection) {
      const evaluationEvidence = JobEvaluationEvidenceSchema.safeParse(context.jobEvaluationEvidence);
      if (!evaluationEvidence.success || approval.approver?.actorType !== "EVALUATOR" || approval.authorizedActorId !== target.data.evaluatorAddress || evaluationEvidence.data.jobId !== target.data.jobId || evaluationEvidence.data.approvalId !== approval.id || evaluationEvidence.data.intentId !== approval.intentId || evaluationEvidence.data.exactIntentHash !== approval.exactIntentHash || evaluationEvidence.data.decision !== "REJECTED" || evaluationEvidence.data.transactionHash !== transaction.transactionHash || evaluationEvidence.data.transactionNetwork !== transaction.network || evaluationEvidence.data.transactionChainId !== transaction.chainId) throw new InvalidTransitionError("agentic job rejection evidence", from, to);
    } else if (context.jobEvaluationEvidence !== undefined || approval.approver?.actorType !== "FOUNDER" || approval.authorizedActorId !== target.data.clientAddress) {
      throw new InvalidTransitionError("agentic job rejection evidence", from, to);
    }
  }
  return { status: to, auditEvent: event(context, from, to) } as const;
}
export function mapAgenticJobToApplication(status: AgenticJobStatus): ProofSpendApplicationState | null {
  if (status === "REJECTED" || status === "EXPIRED") return "REJECTED";
  return null;
}
