import type { ApprovalRecord, CanonicalExecutionIntent, ExecutionAuthorizationBinding, ReconciliationRecord, ReleaseRequest, SettlementRecord, TransactionRecord } from "./models";

export class RelationshipIntegrityError extends Error { constructor(message: string) { super(message); this.name = "RelationshipIntegrityError"; } }
const assert = (condition: boolean, message: string): void => { if (!condition) throw new RelationshipIntegrityError(message); };

export function serializeCanonicalExecutionIntent(intent: CanonicalExecutionIntent): string {
  const value = intent;
  return JSON.stringify([value.version, value.actionType, value.projectId, value.releaseRequestId, value.transactionRecordId, value.intentId, value.asset, value.atomicAmount, value.operationType, value.destinationReference, value.network, value.chainId]);
}

export async function hashCanonicalExecutionIntent(intent: CanonicalExecutionIntent): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serializeCanonicalExecutionIntent(intent)));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function validateExecutionAuthorization(approval: ApprovalRecord, release: ReleaseRequest, transaction: TransactionRecord, binding: ExecutionAuthorizationBinding, asOf: string): Promise<true> {
  assert(binding.releaseRequestId === release.id && binding.approvalId === approval.id && binding.transactionRecordId === transaction.id, "Authorization binding record IDs do not match.");
  assert(release.approvalId === approval.id && transaction.approvalId === approval.id && transaction.approvalBindingId === binding.id, "Release or transaction does not reference the approval and authorization binding.");
  assert(approval.decision === "APPROVED", "Execution requires an approved decision.");
  assert(Date.parse(approval.expiresAt) > Date.parse(asOf), "Approval is expired.");
  assert(release.intentId === binding.intentId && transaction.intentId === binding.intentId, "Release and transaction intent IDs do not match binding.");
  assert(release.projectId === transaction.projectId, "Release and transaction projects do not match.");
  assert(release.id === transaction.releaseRequestId, "Transaction references an unrelated release.");
  assert(release.amount.asset === transaction.amount.asset && release.amount.atomicUnits === transaction.amount.atomicUnits, "Release and transaction amounts do not match exactly.");
  const intent = binding.executionIntent;
  assert(intent.version === 1, "Canonical execution intent version is unsupported.");
  assert(intent.actionType === approval.actionType && intent.projectId === release.projectId && intent.releaseRequestId === release.id && intent.transactionRecordId === transaction.id && intent.intentId === release.intentId, "Canonical execution identifiers or action do not match persisted records.");
  assert(intent.asset === release.amount.asset && intent.atomicAmount === release.amount.atomicUnits, "Canonical execution amount does not match persisted amount.");
  assert(intent.operationType === transaction.arcTransaction?.operationType && intent.destinationReference === transaction.destinationReference, "Canonical execution operation or destination does not match transaction.");
  assert(intent.network === (transaction.arcTransaction?.network ?? null) && intent.chainId === (transaction.arcTransaction?.chainId ?? null), "Canonical execution network does not match transaction.");
  const recomputedHash = await hashCanonicalExecutionIntent(intent);
  assert(recomputedHash === approval.exactIntentHash && recomputedHash === binding.exactIntentHash, "Recomputed exact intent hash does not match approval and binding.");
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

export function validateReconciliation(transaction: TransactionRecord, settlement: SettlementRecord, reconciliation: ReconciliationRecord, authorizedAdapterId?: string): true {
  assert(authorizedAdapterId !== undefined && reconciliation.actor.actorType === "ADAPTER" && reconciliation.actor.actorId === authorizedAdapterId, "Reconciliation requires the exact authorized adapter.");
  assert(reconciliation.transactionRecordId === transaction.id && reconciliation.settlementId === settlement.id, "Reconciliation targets unrelated records.");
  assert(transaction.projectId === settlement.projectId && reconciliation.projectId === transaction.projectId, "Reconciliation project IDs do not match.");
  assert(transaction.releaseRequestId === settlement.releaseRequestId, "Transaction and settlement release relationships do not match.");
  assert(transaction.arcTransaction?.status === "CONFIRMED", "Reconciled transaction must retain confirmed Arc evidence.");
  assert(settlement.transaction?.status === "CONFIRMED" && (settlement.transaction.operationType === "SETTLEMENT" || settlement.transaction.operationType === "REFUND"), "Reconciled settlement evidence is incompatible.");
  assert(reconciliation.evidenceReference.length > 0 && reconciliation.result.length > 0, "Reconciliation result and evidence must be persisted.");
  if (reconciliation.result !== "MATCHED") {
    assert(transaction.operationState !== "RECONCILED" && settlement.state !== "RECONCILED" && transaction.reconciliationId === null && settlement.reconciliationId === null, "Divergent reconciliation cannot advance lifecycle state.");
    return true;
  }
  assert(transaction.operationState === "RECONCILED" && settlement.state === "RECONCILED", "Matched reconciliation requires both records to be reconciled.");
  assert(transaction.reconciliationId === reconciliation.id && settlement.reconciliationId === reconciliation.id, "Records do not reference reconciliation.");
  assert(transaction.amount.asset === settlement.amount.asset && transaction.amount.atomicUnits === settlement.amount.atomicUnits, "Matched reconciliation amounts differ.");
  const left = transaction.arcTransaction; const right = settlement.transaction;
  if (left === null || right === null) throw new RelationshipIntegrityError("Matched reconciliation requires Arc evidence on both records.");
  assert(left.network === right.network && left.chainId === right.chainId && left.transactionHash === right.transactionHash && left.blockNumber === right.blockNumber && left.blockHash === right.blockHash && left.operationType === right.operationType && left.status === "CONFIRMED" && right.status === "CONFIRMED", "Matched reconciliation Arc evidence differs.");
  assert((settlement.state === "RECONCILED") && (right.operationType === "SETTLEMENT" || right.operationType === "REFUND"), "Matched operation is incompatible with settlement.");
  return true;
}
