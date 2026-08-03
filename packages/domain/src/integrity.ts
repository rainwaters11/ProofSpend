import type { ApprovalRecord, ExecutionAuthorizationBinding, ReconciliationRecord, ReleaseRequest, SettlementRecord, TransactionRecord } from "./models";

export class RelationshipIntegrityError extends Error { constructor(message: string) { super(message); this.name = "RelationshipIntegrityError"; } }
const assert = (condition: boolean, message: string): void => { if (!condition) throw new RelationshipIntegrityError(message); };

export function validateExecutionAuthorization(approval: ApprovalRecord, release: ReleaseRequest, transaction: TransactionRecord, binding: ExecutionAuthorizationBinding, asOf: string): true {
  assert(binding.releaseRequestId === release.id && binding.approvalId === approval.id && binding.transactionRecordId === transaction.id, "Authorization binding record IDs do not match.");
  assert(release.approvalId === approval.id && transaction.approvalId === approval.id && transaction.approvalBindingId === binding.id, "Release or transaction does not reference the approval and authorization binding.");
  assert(approval.decision === "APPROVED", "Execution requires an approved decision.");
  assert(Date.parse(approval.expiresAt) > Date.parse(asOf), "Approval is expired.");
  assert(approval.exactIntentHash === binding.exactIntentHash, "Approved exact intent hash does not match binding.");
  assert(release.intentId === binding.intentId && transaction.intentId === binding.intentId, "Release and transaction intent IDs do not match binding.");
  assert(release.projectId === transaction.projectId, "Release and transaction projects do not match.");
  return true;
}

export function validateReleaseConfirmation(release: ReleaseRequest, settlement: SettlementRecord): true {
  assert(release.state === "CONFIRMED" && release.settlementId === settlement.id, "Confirmed release must reference the settlement.");
  assert(settlement.releaseRequestId === release.id && settlement.projectId === release.projectId, "Settlement relationship does not match release.");
  assert(settlement.amount.asset === release.amount.asset && settlement.amount.atomicUnits === release.amount.atomicUnits, "Settlement amount does not match release.");
  assert(settlement.state === "CONFIRMED" || settlement.state === "RECONCILED", "Settlement is not confirmed or reconciled.");
  assert(settlement.transaction?.status === "CONFIRMED" && settlement.transaction.operationType === "SETTLEMENT", "Release requires confirmed settlement transaction evidence.");
  return true;
}

export function validateReconciliation(transaction: TransactionRecord, settlement: SettlementRecord, reconciliation: ReconciliationRecord): true {
  assert(transaction.operationState === "RECONCILED" && settlement.state === "RECONCILED", "Both records must claim reconciliation.");
  assert(transaction.reconciliationId === reconciliation.id && settlement.reconciliationId === reconciliation.id, "Records do not reference reconciliation.");
  assert(reconciliation.transactionRecordId === transaction.id && reconciliation.settlementId === settlement.id, "Reconciliation targets unrelated records.");
  assert(transaction.projectId === settlement.projectId && reconciliation.projectId === transaction.projectId, "Reconciliation project IDs do not match.");
  assert(transaction.arcTransaction?.status === "CONFIRMED", "Reconciled transaction must retain confirmed Arc evidence.");
  assert(settlement.transaction?.status === "CONFIRMED" && (settlement.transaction.operationType === "SETTLEMENT" || settlement.transaction.operationType === "REFUND"), "Reconciled settlement evidence is incompatible.");
  assert(reconciliation.evidenceReference.length > 0 && reconciliation.result.length > 0, "Reconciliation result and evidence must be persisted.");
  return true;
}
