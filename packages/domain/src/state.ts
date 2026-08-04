import { ExecutionAuthorizationBindingSchema, ReconciliationRecordSchema, SettlementRecordSchema, SubmissionOperationRecordSchema, TransactionRecordSchema, type Actor, type AgenticJobStatus, type AuditEvent, type ExecutionAuthorizationBinding, type ReconciliationRecord, type SettlementRecord, type SubmissionOperationRecord, type TransactionRecord } from "./models";
import { validateReconciliation } from "./integrity";

export class InvalidTransitionError extends Error {
  constructor(readonly machine: string, readonly from: string, readonly to: string) {
    super(`Invalid ${machine} transition from ${from} to ${to}.`); this.name = "InvalidTransitionError";
  }
}
export type ProofSpendApplicationState = "INCOMPLETE" | "NEEDS_REVIEW" | "ELIGIBLE" | "APPROVAL_PENDING" | "APPROVED" | "PREPARED" | "SUBMITTED" | "CONFIRMED" | "REJECTED" | "FAILED" | "RECONCILED";
const applicationTransitions: Record<ProofSpendApplicationState, readonly ProofSpendApplicationState[]> = {
  INCOMPLETE: ["NEEDS_REVIEW"], NEEDS_REVIEW: ["INCOMPLETE", "ELIGIBLE", "REJECTED"], ELIGIBLE: ["APPROVAL_PENDING"],
  APPROVAL_PENDING: ["APPROVED", "REJECTED"], APPROVED: ["PREPARED"], PREPARED: ["SUBMITTED", "FAILED"],
  SUBMITTED: ["CONFIRMED", "FAILED"], CONFIRMED: ["RECONCILED"], REJECTED: [], FAILED: [], RECONCILED: [],
};
const jobTransitions: Record<AgenticJobStatus, readonly AgenticJobStatus[]> = {
  OPEN: ["FUNDED", "EXPIRED"], FUNDED: ["SUBMITTED", "EXPIRED"], SUBMITTED: ["COMPLETED", "REJECTED", "EXPIRED"],
  COMPLETED: [], REJECTED: [], EXPIRED: [],
};
export interface TransitionContext {
  aggregateType: string; aggregateId: string; eventId: string; occurredAt: string; actor: Actor;
  authorizedSystemId?: string; authorizedApproverId?: string; authorizedAdapterId?: string; authorizedEvaluatorId?: string; idempotencyKey?: string;
  confirmationTransaction?: TransactionRecord; expectedTransactionId?: string; expectedProjectId?: string; expectedReleaseRequestId?: string; expectedOperationType?: NonNullable<TransactionRecord["arcTransaction"]>["operationType"];
  expectedIntentId?: string; expectedApprovalId?: string; expectedApprovalBindingId?: string;
  submissionTransaction?: TransactionRecord; executionBinding?: ExecutionAuthorizationBinding; submissionOperation?: SubmissionOperationRecord;
  reconciliationTransaction?: TransactionRecord; reconciliationSettlement?: SettlementRecord; reconciliationRecord?: ReconciliationRecord;
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
  "PREPARED->SUBMITTED": { actorTypes: ["ADAPTER"], identifier: "authorizedAdapterId" },
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
  if (from === "PREPARED" && to === "SUBMITTED") {
    const transaction = TransactionRecordSchema.safeParse(context.submissionTransaction);
    const binding = ExecutionAuthorizationBindingSchema.safeParse(context.executionBinding);
    const submission = SubmissionOperationRecordSchema.safeParse(context.submissionOperation);
    if (!transaction.success || !binding.success || !submission.success || transaction.data.operationState !== "SUBMITTED" || transaction.data.arcTransaction?.status !== "SUBMITTED" || binding.data.status !== "CONSUMED" || binding.data.consumedAt === null || binding.data.consumedByTransactionId !== transaction.data.id || binding.data.transactionRecordId !== transaction.data.id || binding.data.releaseRequestId !== transaction.data.releaseRequestId || binding.data.intentId !== transaction.data.intentId || binding.data.approvalId !== transaction.data.approvalId || transaction.data.approvalBindingId !== binding.data.id || submission.data.transactionId !== transaction.data.id || context.idempotencyKey === undefined || submission.data.idempotencyKey !== context.idempotencyKey || context.aggregateId !== transaction.data.releaseRequestId || transaction.data.id !== context.expectedTransactionId || transaction.data.projectId !== context.expectedProjectId || transaction.data.releaseRequestId !== context.expectedReleaseRequestId || transaction.data.intentId !== context.expectedIntentId || transaction.data.approvalId !== context.expectedApprovalId || transaction.data.approvalBindingId !== context.expectedApprovalBindingId) throw new InvalidTransitionError("ProofSpend application submission evidence", from, to);
  }
  if (from === "SUBMITTED" && to === "CONFIRMED") {
    const parsed = TransactionRecordSchema.safeParse(context.confirmationTransaction);
    const transaction = parsed.success ? parsed.data : null;
    if (transaction === null || transaction.operationState !== "CONFIRMED" || transaction.arcTransaction?.status !== "CONFIRMED" || context.expectedTransactionId === undefined || context.expectedProjectId === undefined || context.expectedReleaseRequestId === undefined || context.expectedOperationType === undefined || transaction.id !== context.expectedTransactionId || transaction.projectId !== context.expectedProjectId || transaction.releaseRequestId !== context.expectedReleaseRequestId || transaction.arcTransaction.operationType !== context.expectedOperationType) throw new InvalidTransitionError("ProofSpend application confirmation evidence", from, to);
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
export function transitionAgenticJob(from: AgenticJobStatus, to: AgenticJobStatus, context: TransitionContext) {
  if (!jobTransitions[from].includes(to)) throw new InvalidTransitionError("agentic job", from, to);
  const authority = jobAuthority[`${from}->${to}`];
  if (authority === undefined || context.actor.actorType !== authority.actorType || context[authority.identifier] === undefined || context.actor.actorId !== context[authority.identifier]) throw new InvalidTransitionError("agentic job authority", from, to);
  return { status: to, auditEvent: event(context, from, to) } as const;
}
export function mapAgenticJobToApplication(status: AgenticJobStatus): ProofSpendApplicationState | null {
  if (status === "REJECTED" || status === "EXPIRED") return "REJECTED";
  return null;
}
