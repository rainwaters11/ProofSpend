import { ApprovalRecordSchema, CanonicalExecutionIntentSchema, ExecutionAuthorizationBindingSchema, LedgerEntrySchema, ReleaseRequestSchema, SettlementRecordSchema, TransactionRecordSchema, ReconciliationRecordSchema, type ApprovalRecord, type CanonicalExecutionIntent, type ExecutionAuthorizationBinding, type LedgerEntry, type ReconciliationRecord, type ReleaseRequest, type SettlementRecord, type TransactionRecord } from "./models";

export class RelationshipIntegrityError extends Error { constructor(message: string) { super(message); this.name = "RelationshipIntegrityError"; } }
function assert(condition: boolean, message: string): asserts condition { if (!condition) throw new RelationshipIntegrityError(message); }

export function serializeCanonicalExecutionIntent(intent: CanonicalExecutionIntent): string {
  const target = intent.protocolTarget;
  const targetValues = target.kind === "DESTINATION"
    ? [target.kind, target.isMock, target.destination, target.sourceWalletId, target.network, target.chainId]
    : [target.kind, target.standard, target.network, target.chainId, target.contractReference, target.jobId, target.method, target.parameterCommitment, target.clientReference, target.providerReference, target.evaluatorReference, target.destination];
  return JSON.stringify([intent.version, intent.actionKind, intent.projectId, intent.releaseRequestId, intent.transactionRecordId, intent.intentId, intent.asset, intent.atomicAmount, intent.operationType, ...targetValues]);
}

export async function hashCanonicalExecutionIntent(intent: CanonicalExecutionIntent): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serializeCanonicalExecutionIntent(intent)));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export interface JobParameterCommitmentInput {
  operationType: "JOB_FUND" | "JOB_SUBMIT" | "JOB_EVALUATE" | "JOB_REJECT" | "REFUND";
  jobId: string;
  asset: string;
  atomicAmount: string;
  deliverableReference: string | null;
  decision: "APPROVED" | "REJECTED" | null;
  reasonReference: string | null;
}

export function serializeJobParameterCommitment(input: JobParameterCommitmentInput): string {
  return JSON.stringify([1, input.operationType, input.jobId, input.asset, input.atomicAmount, input.deliverableReference, input.decision, input.reasonReference]);
}

export async function hashJobParameterCommitment(input: JobParameterCommitmentInput): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serializeJobParameterCommitment(input)));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

type ExecutionApprovalPolicy =
  | { actionKind: "RELEASE_APPROVAL"; actorType: "FOUNDER"; targetKind: "DESTINATION" }
  | { actionKind: "JOB_EVALUATION" | "JOB_REJECTION"; actorType: "EVALUATOR"; targetKind: "ERC8183" };
function requiredApprovalPolicy(intent: CanonicalExecutionIntent): ExecutionApprovalPolicy {
  if (intent.operationType === "SETTLEMENT" || intent.operationType === "REFUND") {
    assert(intent.protocolTarget.kind === "DESTINATION", `${intent.operationType} requires an exact destination target.`);
    return { actionKind: "RELEASE_APPROVAL", actorType: "FOUNDER", targetKind: "DESTINATION" };
  }
  if (intent.operationType === "JOB_EVALUATE" || intent.operationType === "JOB_REJECT") {
    assert(intent.protocolTarget.kind === "ERC8183" && intent.protocolTarget.method === intent.operationType, `${intent.operationType} requires its exact ERC-8183 job target.`);
    return { actionKind: intent.operationType === "JOB_EVALUATE" ? "JOB_EVALUATION" : "JOB_REJECTION", actorType: "EVALUATOR", targetKind: "ERC8183" };
  }
  throw new RelationshipIntegrityError(`Release execution authorization cannot authorize job-scoped ${intent.operationType} writes.`);
}

export interface TerminalJobExecutionContext {
  settlement: SettlementRecord;
  parameters: JobParameterCommitmentInput;
}

export async function validateExecutionAuthorization(approval: ApprovalRecord, release: ReleaseRequest, transaction: TransactionRecord, binding: ExecutionAuthorizationBinding, asOf: string, terminalJobContext?: TerminalJobExecutionContext): Promise<true> {
  approval = ApprovalRecordSchema.parse(approval); release = ReleaseRequestSchema.parse(release); transaction = TransactionRecordSchema.parse(transaction); binding = ExecutionAuthorizationBindingSchema.parse(binding);
  assert(release.state === "PREPARED", "Pre-submission authorization requires a PREPARED release.");
  if (transaction.operationState !== "PREPARED" || transaction.arcTransaction === null || transaction.arcTransaction.status !== "PREPARED") throw new RelationshipIntegrityError("Pre-submission authorization requires compatible PREPARED transaction evidence.");
  assert(transaction.arcTransaction.transactionHash === null && transaction.arcTransaction.blockNumber === null && transaction.arcTransaction.blockHash === null && transaction.arcTransaction.explorerUrl === null, "PREPARED transaction cannot contain submission or confirmation evidence.");
  assert(binding.status === "ACTIVE" && binding.consumedAt === null && binding.consumedByTransactionId === null, "Execution authorization binding is not active.");
  assert(binding.releaseRequestId === release.id && binding.approvalId === approval.id && binding.transactionRecordId === transaction.id, "Authorization binding record IDs do not match.");
  assert(approval.intentId === binding.intentId, "Approval subject does not match the release intent.");
  assert(release.approvalId === approval.id && transaction.approvalId === approval.id && transaction.approvalBindingId === binding.id, "Release or transaction does not reference the approval and authorization binding.");
  assert(approval.decision === "APPROVED", "Execution requires an approved decision.");
  const intent = CanonicalExecutionIntentSchema.parse(binding.executionIntent);
  const policy = requiredApprovalPolicy(intent);
  const approvalSubjectMatches =
    policy.targetKind === "DESTINATION"
      ? approval.aggregateId === release.id
      : intent.protocolTarget.kind === "ERC8183" &&
        approval.aggregateId === intent.protocolTarget.jobId &&
        approval.authorizedActorId === intent.protocolTarget.evaluatorReference;
  assert(approvalSubjectMatches, "Approval subject does not match the release or terminal ERC-8183 job intent.");
  assert(approval.actionKind === policy.actionKind && approval.authorizedActorType === policy.actorType && approval.approver?.actorType === policy.actorType && approval.approver.actorId === approval.authorizedActorId, "Approval policy or exact authorized actor does not match.");
  const decidedAt = approval.decidedAt === null ? Number.NaN : Date.parse(approval.decidedAt);
  const authorizationAt = Date.parse(asOf);
  const expiresAt = Date.parse(approval.expiresAt);
  assert(Number.isFinite(decidedAt) && Number.isFinite(authorizationAt) && Number.isFinite(expiresAt), "Approval chronology requires valid timestamps.");
  assert(decidedAt <= authorizationAt && authorizationAt < expiresAt && decidedAt <= expiresAt, "Execution authorization must satisfy decidedAt <= asOf < expiresAt.");
  assert(release.intentId === binding.intentId && transaction.intentId === binding.intentId, "Release and transaction intent IDs do not match binding.");
  assert(release.projectId === transaction.projectId, "Release and transaction projects do not match.");
  assert(release.id === transaction.releaseRequestId, "Transaction references an unrelated release.");
  assert(release.amount.asset === transaction.amount.asset && release.amount.atomicUnits === transaction.amount.atomicUnits, "Release and transaction amounts do not match exactly.");
  assert(intent.version === 1, "Canonical execution intent version is unsupported.");
  assert(intent.actionKind === approval.actionKind && intent.projectId === release.projectId && intent.releaseRequestId === release.id && intent.transactionRecordId === transaction.id && intent.intentId === release.intentId, "Canonical execution identifiers or action do not match persisted records.");
  assert(intent.asset === release.amount.asset && intent.atomicAmount === release.amount.atomicUnits, "Canonical execution amount does not match persisted amount.");
  assert(intent.operationType === transaction.arcTransaction.operationType && intent.protocolTarget.destination === transaction.destinationReference, "Canonical execution operation or destination does not match transaction.");
  assert(intent.protocolTarget.network === transaction.arcTransaction.network && intent.protocolTarget.chainId === transaction.arcTransaction.chainId, "Canonical execution network does not match transaction.");
  if (intent.protocolTarget.kind === "DESTINATION") {
    assert(intent.protocolTarget.isMock === transaction.arcTransaction.isMock, "Canonical destination mode does not match transaction mode.");
  } else {
    assert(terminalJobContext !== undefined, "Terminal ERC-8183 execution requires release-linked job evidence and parameter commitment inputs.");
    const settlement = SettlementRecordSchema.parse(terminalJobContext.settlement);
    const job = settlement.job;
    const settlementTransaction = settlement.transaction;
    const target = intent.protocolTarget;
    const parameters = terminalJobContext.parameters;
    assert(job !== null && settlementTransaction !== null, "Terminal ERC-8183 execution requires a job-backed pending settlement transaction.");
    assert(settlement.releaseRequestId === release.id && settlement.projectId === release.projectId, "Terminal job evidence does not belong to the prepared release.");
    assert(settlement.amount.asset === release.amount.asset && settlement.amount.atomicUnits === release.amount.atomicUnits, "Terminal job settlement amount does not match the prepared release.");
    assert(
      settlementTransaction.network === transaction.arcTransaction.network &&
      settlementTransaction.chainId === transaction.arcTransaction.chainId &&
      settlementTransaction.transactionHash === transaction.arcTransaction.transactionHash &&
      settlementTransaction.status === transaction.arcTransaction.status &&
      settlementTransaction.blockNumber === transaction.arcTransaction.blockNumber &&
      settlementTransaction.blockHash === transaction.arcTransaction.blockHash &&
      settlementTransaction.explorerUrl === transaction.arcTransaction.explorerUrl &&
      settlementTransaction.operationType === transaction.arcTransaction.operationType &&
      settlementTransaction.isMock === transaction.arcTransaction.isMock,
      "Terminal job settlement transaction does not match the prepared transaction."
    );
    const priorJobTransaction = job.transaction;
    const compatibleJobState =
      (intent.operationType === "JOB_EVALUATE" && settlement.state === "PENDING" && job.status === "SUBMITTED" && priorJobTransaction?.status === "CONFIRMED" && priorJobTransaction.operationType === "JOB_SUBMIT") ||
      (intent.operationType === "JOB_REJECT" && settlement.state === "REFUND_PENDING" &&
        ((job.status === "FUNDED" && priorJobTransaction?.status === "CONFIRMED" && priorJobTransaction.operationType === "JOB_FUND") ||
         (job.status === "SUBMITTED" && priorJobTransaction?.status === "CONFIRMED" && priorJobTransaction.operationType === "JOB_SUBMIT")));
    assert(compatibleJobState, "Terminal job operation is incompatible with the release's current ERC-8183 job state.");
    assert(
      target.standard === job.standard &&
      target.contractReference === job.contractAddress &&
      target.jobId === job.jobId &&
      target.clientReference === job.clientAddress &&
      target.providerReference === job.providerAddress &&
      target.evaluatorReference === job.evaluatorAddress &&
      target.destination === job.contractAddress &&
      target.network === priorJobTransaction?.network &&
      target.chainId === priorJobTransaction?.chainId &&
      transaction.arcTransaction.isMock === priorJobTransaction?.isMock,
      "Terminal execution target does not match the release's exact ERC-8183 job contract and parties."
    );
    const expectedDecision = intent.operationType === "JOB_EVALUATE" ? "APPROVED" : "REJECTED";
    assert(
      parameters.operationType === intent.operationType &&
      parameters.jobId === job.jobId &&
      parameters.asset === job.budget.asset &&
      parameters.atomicAmount === job.budget.atomicUnits &&
      parameters.deliverableReference === job.deliverableReference &&
      parameters.decision === expectedDecision &&
      (intent.operationType !== "JOB_REJECT" || (parameters.reasonReference !== null && parameters.reasonReference.trim().length > 0)),
      "Terminal job parameter commitment inputs do not match the release's current job evidence."
    );
    const recomputedParameterCommitment = await hashJobParameterCommitment(parameters);
    assert(recomputedParameterCommitment === target.parameterCommitment, "Terminal job parameter commitment does not match the exact ERC-8183 job target.");
  }
  const recomputedHash = await hashCanonicalExecutionIntent(intent);
  assert(recomputedHash === approval.exactIntentHash && recomputedHash === binding.exactIntentHash, "Recomputed exact intent hash does not match approval and binding.");
  return true;
}

export function validateLedgerReversal(reversal: LedgerEntry, targetEntry: LedgerEntry | null | undefined, acceptedReversals: readonly LedgerEntry[] = []): true {
  const parsedReversal = LedgerEntrySchema.parse(reversal);
  assert(parsedReversal.kind === "REVERSAL", "Ledger relationship validation requires a reversal entry.");
  if (targetEntry === null || targetEntry === undefined) throw new RelationshipIntegrityError("Ledger reversal target does not exist or match.");
  const parsedTarget = LedgerEntrySchema.parse(targetEntry);
  assert(parsedTarget.id === parsedReversal.reversesEntryId && parsedTarget.id !== parsedReversal.id && parsedTarget.vaultId === parsedReversal.vaultId && parsedTarget.reserveId === parsedReversal.reserveId, "Ledger reversal target must be a different matching entry in the same vault.");
  assert(parsedTarget.amount.asset === parsedReversal.amount.asset, "Ledger reversal asset does not match target.");
  const alreadyReversed = acceptedReversals.map((entry) => LedgerEntrySchema.parse(entry)).reduce((total, entry) => {
    assert(entry.kind === "REVERSAL" && entry.reversesEntryId === parsedTarget.id && entry.vaultId === parsedTarget.vaultId && entry.reserveId === parsedTarget.reserveId && entry.amount.asset === parsedTarget.amount.asset, "Accepted reversal is unrelated to the target ledger entry.");
    return total + BigInt(entry.amount.atomicUnits);
  }, 0n);
  assert(alreadyReversed + BigInt(parsedReversal.amount.atomicUnits) <= BigInt(parsedTarget.amount.atomicUnits), "Ledger reversal exceeds the remaining target amount.");
  return true;
}

export function validateReleaseConfirmation(release: ReleaseRequest, settlement: SettlementRecord): true {
  release = ReleaseRequestSchema.parse(release); settlement = SettlementRecordSchema.parse(settlement);
  assert(release.state === "CONFIRMED" && release.settlementId === settlement.id, "Confirmed release must reference the settlement.");
  assert(settlement.releaseRequestId === release.id && settlement.projectId === release.projectId, "Settlement relationship does not match release.");
  assert(settlement.amount.asset === release.amount.asset && settlement.amount.atomicUnits === release.amount.atomicUnits, "Settlement amount does not match release.");
  const operationType = settlement.transaction?.operationType;
  const confirmedDisposition = settlement.transaction?.status === "CONFIRMED" && (
    (settlement.state === "CONFIRMED" && (operationType === "SETTLEMENT" || operationType === "JOB_EVALUATE")) ||
    (settlement.state === "REFUNDED" && (operationType === "REFUND" || operationType === "JOB_REJECT")) ||
    (settlement.state === "RECONCILED" && (operationType === "SETTLEMENT" || operationType === "JOB_EVALUATE" || operationType === "REFUND" || operationType === "JOB_REJECT"))
  );
  assert(confirmedDisposition, "Release requires compatible confirmed settlement or refund transaction evidence.");
  return true;
}

export function validateReconciliation(transaction: TransactionRecord, settlement: SettlementRecord, reconciliation: ReconciliationRecord, authorizedAdapterId?: string): true {
  const parsedTransaction = TransactionRecordSchema.parse(transaction);
  const parsedSettlement = SettlementRecordSchema.parse(settlement);
  const parsedReconciliation = ReconciliationRecordSchema.parse(reconciliation);
  assert(authorizedAdapterId !== undefined && parsedReconciliation.actor.actorType === "ADAPTER" && parsedReconciliation.actor.actorId === authorizedAdapterId, "Reconciliation requires the exact authorized adapter.");
  assert(parsedReconciliation.transactionRecordId === parsedTransaction.id && parsedReconciliation.settlementId === parsedSettlement.id, "Reconciliation targets unrelated records.");
  assert(parsedTransaction.projectId === parsedSettlement.projectId && parsedReconciliation.projectId === parsedTransaction.projectId, "Reconciliation project IDs do not match.");
  assert(parsedTransaction.releaseRequestId === parsedSettlement.releaseRequestId, "Transaction and settlement release relationships do not match.");
  assert(parsedTransaction.arcTransaction?.status === "CONFIRMED", "Reconciled transaction must retain confirmed Arc evidence.");
  assert(parsedSettlement.transaction?.status === "CONFIRMED" && (parsedSettlement.transaction.operationType === "SETTLEMENT" || parsedSettlement.transaction.operationType === "JOB_EVALUATE" || parsedSettlement.transaction.operationType === "REFUND" || parsedSettlement.transaction.operationType === "JOB_REJECT"), "Reconciled settlement evidence is incompatible.");
  if (parsedReconciliation.result !== "MATCHED") {
    assert(parsedTransaction.operationState !== "RECONCILED" && parsedSettlement.state !== "RECONCILED" && parsedTransaction.reconciliationId === null && parsedSettlement.reconciliationId === null, "Divergent reconciliation cannot advance lifecycle state.");
    return true;
  }
  assert(parsedTransaction.operationState === "RECONCILED" && parsedSettlement.state === "RECONCILED", "Matched reconciliation requires both records to be reconciled.");
  assert(parsedTransaction.reconciliationId === parsedReconciliation.id && parsedSettlement.reconciliationId === parsedReconciliation.id, "Records do not reference reconciliation.");
  assert(parsedTransaction.amount.asset === parsedSettlement.amount.asset && parsedTransaction.amount.atomicUnits === parsedSettlement.amount.atomicUnits, "Matched reconciliation amounts differ.");
  const left = parsedTransaction.arcTransaction; const right = parsedSettlement.transaction;
  if (left === null || right === null) throw new RelationshipIntegrityError("Matched reconciliation requires Arc evidence on both records.");
  assert(left.network === right.network && left.chainId === right.chainId && left.transactionHash === right.transactionHash && left.blockNumber === right.blockNumber && left.blockHash === right.blockHash && left.explorerUrl === right.explorerUrl && left.operationType === right.operationType && left.isMock === right.isMock && left.status === "CONFIRMED" && right.status === "CONFIRMED", "Matched reconciliation Arc evidence differs.");
  assert((parsedSettlement.state === "RECONCILED") && (right.operationType === "SETTLEMENT" || right.operationType === "JOB_EVALUATE" || right.operationType === "REFUND" || right.operationType === "JOB_REJECT"), "Matched operation is incompatible with settlement.");
  return true;
}
