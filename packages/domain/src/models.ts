import { z } from "zod";
import { AtomicUnitsSchema, MoneyAmountSchema } from "./money";
import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_NETWORK, arcTestnetExplorerTransactionUrl } from "./network";

const Id = z.string().min(1);
const Time = z.string().datetime();
const Hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const EvmAddress = /^0x[a-fA-F0-9]{40}$/;
const EvmHash = /^0x[a-fA-F0-9]{64}$/;
const isSynthetic = (value: string) => /^(mock:|synthetic:)/.test(value);
export const LAUNCHVAULT_SETTLEMENT_ASSET = "USDC" as const;
export const SettlementMoneyAmountSchema = MoneyAmountSchema.extend({ asset: z.literal(LAUNCHVAULT_SETTLEMENT_ASSET) });
export type SettlementMoneyAmount = z.infer<typeof SettlementMoneyAmountSchema>;
export const VisibilitySchema = z.enum(["FOUNDER_PRIVATE", "BACKER_SHARED", "ONCHAIN_PUBLIC"]);
export const ActorSchema = z.object({ actorId: Id, actorType: z.enum(["SYSTEM", "AI", "FOUNDER", "BACKER", "PROVIDER", "EVALUATOR", "ADAPTER"]) });
export type Actor = z.infer<typeof ActorSchema>;

export const AgenticJobStatusSchema = z.enum(["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"]);
export type AgenticJobStatus = z.infer<typeof AgenticJobStatusSchema>;
export const AgentIdentityRefSchema = z.object({
  standard: z.literal("ERC-8004"), network: z.string().min(1), chainId: z.string().min(1), registryAddress: z.string().min(1),
  agentId: z.string().min(1), ownerAddress: z.string().min(1), metadataVersion: z.string().min(1),
  registrationStatus: z.enum(["UNREGISTERED", "PENDING", "REGISTERED"]), registrationReference: z.string().min(1).nullable(), isMock: z.boolean(),
}).superRefine((value, context) => {
  if (!value.isMock) context.addIssue({ code: "custom", message: "Live ERC-8004 identity behavior is deferred to Issue #13." });
  if (value.registrationStatus === "REGISTERED" && value.registrationReference === null) context.addIssue({ code: "custom", message: "Registered identity requires a registration reference." });
  if (value.isMock && [value.network, value.chainId, value.registryAddress, value.agentId, value.ownerAddress, value.registrationReference].filter((item): item is string => item !== null).some((item) => !isSynthetic(item))) context.addIssue({ code: "custom", message: "Every mock identity reference must be visibly synthetic." });
  if (!value.isMock && [value.network, value.chainId, value.registryAddress, value.agentId, value.ownerAddress, value.registrationReference].filter((item): item is string => item !== null).some(isSynthetic)) context.addIssue({ code: "custom", message: "Synthetic identity references cannot be marked live." });
});
export type AgentIdentityRef = z.infer<typeof AgentIdentityRefSchema>;
export const AgentReputationRefSchema = z.object({
  standard: z.literal("ERC-8004"), network: z.string().min(1), chainId: z.string().min(1), registryAddress: z.string().min(1), agentId: z.string().min(1),
  writerAddress: z.string().min(1), agentOwnerAddress: z.string().min(1), eventReference: z.string().min(1),
  score: z.number().finite().nullable(), tag: z.string().min(1).nullable(), recordedAt: Time.nullable(), isMock: z.boolean(),
}).refine((value) => value.score !== null || value.tag !== null, "Reputation requires an explicit score or tag.").refine(
  (value) => value.writerAddress.trim().toLowerCase() !== value.agentOwnerAddress.trim().toLowerCase(),
  "Agent owner cannot write its own reputation.",
).superRefine((value, context) => {
  if (!value.isMock) context.addIssue({ code: "custom", message: "Live ERC-8004 reputation writes are deferred to Issue #13." });
  if (value.isMock && [value.network, value.chainId, value.registryAddress, value.agentId, value.writerAddress, value.agentOwnerAddress, value.eventReference].some((item) => !isSynthetic(item))) context.addIssue({ code: "custom", message: "Every mock reputation reference must be visibly synthetic." });
  if (!value.isMock && [value.network, value.chainId, value.registryAddress, value.agentId, value.eventReference].some(isSynthetic)) context.addIssue({ code: "custom", message: "Synthetic reputation references cannot be marked live." });
  if (!value.isMock && (!EvmAddress.test(value.writerAddress) || !EvmAddress.test(value.agentOwnerAddress))) context.addIssue({ code: "custom", message: "Live reputation owner and writer must be EVM addresses." });
});
export type AgentReputationRef = z.infer<typeof AgentReputationRefSchema>;
export const TransactionOperationTypeSchema = z.enum(["IDENTITY_REGISTRATION", "REPUTATION_WRITE", "JOB_CREATE", "JOB_FUND", "JOB_SUBMIT", "JOB_EVALUATE", "JOB_REJECT", "SETTLEMENT", "REFUND"]);
export const ArcTransactionRefSchema = z.object({
  network: z.literal(ARC_TESTNET_NETWORK), chainId: z.string().min(1), transactionHash: z.string().min(1).nullable(),
  status: z.enum(["NONE", "PREPARED", "SUBMITTED", "CONFIRMED", "FAILED"]), blockNumber: z.string().regex(/^\d+$/).nullable(),
  blockHash: z.string().min(1).nullable(), explorerUrl: z.string().url().nullable(),
  operationType: TransactionOperationTypeSchema, isMock: z.boolean(),
}).superRefine((value, context) => {
  if (["NONE", "PREPARED"].includes(value.status) && (value.transactionHash !== null || value.blockNumber !== null || value.blockHash !== null || value.explorerUrl !== null)) context.addIssue({ code: "custom", message: `${value.status} transaction cannot contain transaction or block evidence.` });
  if (value.status === "SUBMITTED" && value.transactionHash === null) context.addIssue({ code: "custom", message: "Submitted transaction requires a transaction hash." });
  if (value.status === "SUBMITTED" && (value.blockNumber !== null || value.blockHash !== null)) context.addIssue({ code: "custom", message: "Submitted transaction cannot contain confirmation block evidence." });
  if (value.status === "CONFIRMED" && (value.transactionHash === null || value.blockNumber === null || value.blockHash === null)) context.addIssue({ code: "custom", message: "Confirmed transaction requires transaction hash, block number, and block hash." });
  if (value.status === "FAILED" && (value.blockNumber !== null || value.blockHash !== null)) context.addIssue({ code: "custom", message: "Failed transaction cannot contain confirmation block evidence." });
  if (value.transactionHash === null && value.explorerUrl !== null) context.addIssue({ code: "custom", message: "A transaction without a hash cannot have an explorer URL." });
  const references = [value.chainId, value.transactionHash, value.blockHash].filter((item): item is string => item !== null);
  if (value.isMock && references.some((item) => !isSynthetic(item))) context.addIssue({ code: "custom", message: "Every mock transaction reference must be visibly synthetic." });
  if (value.isMock && value.explorerUrl !== null) context.addIssue({ code: "custom", message: "Mock transactions cannot have a live explorer URL." });
  if (!value.isMock && references.some(isSynthetic)) context.addIssue({ code: "custom", message: "Synthetic transaction references cannot be marked live." });
  if (!value.isMock && value.chainId !== ARC_TESTNET_CHAIN_ID) context.addIssue({ code: "custom", message: "Live transaction reference must use Arc Testnet chain ID." });
  if (!value.isMock && value.transactionHash !== null && !EvmHash.test(value.transactionHash)) context.addIssue({ code: "custom", message: "Live transaction hash must be a canonical 32-byte EVM hash." });
  if (!value.isMock && value.blockHash !== null && !EvmHash.test(value.blockHash)) context.addIssue({ code: "custom", message: "Live block hash must be a canonical 32-byte EVM hash." });
  if (!value.isMock && value.transactionHash !== null && value.explorerUrl !== arcTestnetExplorerTransactionUrl(value.transactionHash)) context.addIssue({ code: "custom", message: "Live explorer URL must match the exact transaction hash." });
});
export type ArcTransactionRef = z.infer<typeof ArcTransactionRefSchema>;
export const AgenticJobRefSchema = z.object({
  standard: z.literal("ERC-8183"), network: z.string().min(1), chainId: z.string().min(1), contractAddress: z.string().min(1), jobId: z.string().min(1),
  clientAddress: z.string().min(1), providerAddress: z.string().min(1), evaluatorAddress: z.string().min(1),
  budget: SettlementMoneyAmountSchema, expiresAt: Time, descriptionReference: z.string().min(1), deliverableReference: z.string().min(1).nullable(),
  reasonReference: z.string().min(1).nullable(), status: AgenticJobStatusSchema, transaction: ArcTransactionRefSchema.nullable(), escrowTransaction: ArcTransactionRefSchema.nullable().default(null), isMock: z.boolean(),
}).superRefine((value, context) => {
  if (!value.isMock) context.addIssue({ code: "custom", message: "Live ERC-8183 job behavior is deferred to Issue #8." });
  const references = [value.network, value.chainId, value.contractAddress, value.jobId, value.clientAddress, value.providerAddress, value.evaluatorAddress, value.descriptionReference, value.deliverableReference, value.reasonReference].filter((item): item is string => item !== null);
  if (value.isMock && references.some((item) => !isSynthetic(item))) context.addIssue({ code: "custom", message: "Every mock job reference must be visibly synthetic." });
  if (!value.isMock && references.some(isSynthetic)) context.addIssue({ code: "custom", message: "Synthetic job references cannot be marked live." });
  if (value.transaction !== null && value.transaction.isMock !== value.isMock) context.addIssue({ code: "custom", message: "Job and transaction mock/live indicators must match." });
  const escrowTransaction = value.escrowTransaction;
  if (escrowTransaction !== null && escrowTransaction.isMock !== value.isMock) context.addIssue({ code: "custom", message: "Job and prior escrow transaction mock/live indicators must match." });
  const priorEscrowStateValid = escrowTransaction !== null && escrowTransaction.status === "CONFIRMED" && (
    (escrowTransaction.operationType === "JOB_FUND" && value.deliverableReference === null) ||
    (escrowTransaction.operationType === "JOB_SUBMIT" && value.deliverableReference !== null)
  );
  const escrowEvidenceValid =
    (value.status === "REJECTED" && ((escrowTransaction === null && value.deliverableReference === null) || priorEscrowStateValid)) ||
    (value.status === "EXPIRED" && priorEscrowStateValid) ||
    (value.status !== "REJECTED" && value.status !== "EXPIRED" && escrowTransaction === null);
  if (!escrowEvidenceValid) context.addIssue({ code: "custom", message: "Prior escrow evidence is valid only for a rejected job and must preserve its confirmed funded or submitted state." });
  const transaction = value.transaction;
  const statusEvidenceValid =
    (value.status === "OPEN" && value.deliverableReference === null && value.reasonReference === null && transaction === null) ||
    (value.status === "FUNDED" && value.deliverableReference === null && value.reasonReference === null && transaction?.operationType === "JOB_FUND" && transaction.status === "CONFIRMED") ||
    (value.status === "SUBMITTED" && value.deliverableReference !== null && value.reasonReference === null && transaction?.operationType === "JOB_SUBMIT" && transaction.status === "CONFIRMED") ||
    (value.status === "COMPLETED" && value.deliverableReference !== null && transaction?.operationType === "JOB_EVALUATE" && transaction.status === "CONFIRMED") ||
    (value.status === "REJECTED" && transaction?.operationType === "JOB_REJECT" && transaction.status === "CONFIRMED") ||
    (value.status === "EXPIRED" && value.reasonReference === null && transaction?.operationType === "REFUND" && transaction.status === "CONFIRMED");
  if (!statusEvidenceValid) context.addIssue({ code: "custom", message: `${value.status} job requires status-specific deliverable, reason, and transaction evidence.` });
  const unfundedOpenRejection = value.status === "REJECTED" && value.escrowTransaction === null && value.deliverableReference === null;
  if (value.status !== "OPEN" && !unfundedOpenRejection && value.budget.atomicUnits === "0") context.addIssue({ code: "custom", message: `${value.status} job requires a positive ERC-8183 budget.` });
});
export type AgenticJobRef = z.infer<typeof AgenticJobRefSchema>;

export const ProjectSchema = z.object({ id: Id, name: z.string().min(1), founderId: Id, description: z.string(), createdAt: Time });
export type Project = z.infer<typeof ProjectSchema>;
export const BackerSchema = z.object({ id: Id, projectId: Id, displayName: z.string().min(1), createdAt: Time });
export type Backer = z.infer<typeof BackerSchema>;
export const LaunchVaultSchema = z.object({ id: Id, projectId: Id, asset: z.literal(LAUNCHVAULT_SETTLEMENT_ASSET), totalCapital: SettlementMoneyAmountSchema, mode: z.enum(["MOCK", "ARC_TESTNET"]), createdAt: Time }).refine((value) => value.asset === value.totalCapital.asset, "Vault and total capital assets must match.");
export type LaunchVault = z.infer<typeof LaunchVaultSchema>;
export const ReserveSchema = z.object({ id: Id, vaultId: Id, name: z.string().min(1), allocated: SettlementMoneyAmountSchema, status: z.enum(["PROPOSED", "ACTIVE", "CLOSED"]) });
export type Reserve = z.infer<typeof ReserveSchema>;
export const AllocationRuleSchema = z.object({ id: Id, reserveId: Id, purpose: z.string().min(1), maximum: SettlementMoneyAmountSchema, requiresApproval: z.boolean() });
export type AllocationRule = z.infer<typeof AllocationRuleSchema>;
const LedgerEntryBaseSchema = z.object({ id: Id, vaultId: Id, reserveId: Id.nullable(), amount: SettlementMoneyAmountSchema, idempotencyKey: Id, occurredAt: Time });
export const LedgerEntrySchema = z.discriminatedUnion("kind", [
  LedgerEntryBaseSchema.extend({ kind: z.enum(["CAPITAL", "ALLOCATION", "COMMITMENT", "SETTLEMENT", "REFUND"]), reversesEntryId: z.null() }),
  LedgerEntryBaseSchema.extend({ kind: z.literal("REVERSAL"), reversesEntryId: Id }),
]).refine((value) => value.kind !== "REVERSAL" || value.reversesEntryId !== value.id, "A ledger reversal cannot reference itself.");
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export const TransactionRecordSchema = z.object({ id: Id, projectId: Id, releaseRequestId: Id, intentId: Id, destinationReference: z.string().min(1), approvalId: Id.nullable(), approvalBindingId: Id.nullable(), reconciliationId: Id.nullable(), idempotencyKey: Id, amount: SettlementMoneyAmountSchema, operationState: z.enum(["INTENT_PERSISTED", "PREPARED", "SUBMITTED", "CONFIRMED", "FAILED", "RECONCILED"]), arcTransaction: ArcTransactionRefSchema.nullable(), createdAt: Time, updatedAt: Time }).superRefine((value, context) => {
  const compatible: Record<typeof value.operationState, readonly ArcTransactionRef["status"][]> = { INTENT_PERSISTED: ["NONE"], PREPARED: ["PREPARED"], SUBMITTED: ["SUBMITTED"], CONFIRMED: ["CONFIRMED"], FAILED: ["FAILED"], RECONCILED: ["CONFIRMED"] };
  const allowed: readonly ArcTransactionRef["status"][] = compatible[value.operationState];
  if (!(value.operationState === "INTENT_PERSISTED" && value.arcTransaction === null) && (value.arcTransaction === null || !allowed.includes(value.arcTransaction.status))) context.addIssue({ code: "custom", message: `${value.operationState} transaction record requires compatible lifecycle evidence.` });
  if (["PREPARED", "SUBMITTED", "CONFIRMED", "FAILED", "RECONCILED"].includes(value.operationState) && (value.approvalId === null || value.approvalBindingId === null)) context.addIssue({ code: "custom", message: `${value.operationState} transaction requires persisted approval and binding references.` });
  if (value.operationState === "INTENT_PERSISTED" && (value.approvalId !== null || value.approvalBindingId !== null)) context.addIssue({ code: "custom", message: "Persisted intent cannot claim completed approval binding." });
  if (value.operationState === "RECONCILED" ? value.reconciliationId === null : value.reconciliationId !== null) context.addIssue({ code: "custom", message: "Transaction reconciliation reference must match RECONCILED state." });
  if (value.arcTransaction !== null && ["SETTLEMENT", "REFUND"].includes(value.arcTransaction.operationType)) {
    if (value.arcTransaction.isMock && !isSynthetic(value.destinationReference)) context.addIssue({ code: "custom", message: "Mock value-moving transactions require a visibly synthetic destination." });
    if (!value.arcTransaction.isMock && !EvmAddress.test(value.destinationReference)) context.addIssue({ code: "custom", message: "Live value-moving transactions require a canonical EVM destination address." });
  }
});
export type TransactionRecord = z.infer<typeof TransactionRecordSchema>;
export const ApprovalActionKindSchema = z.enum(["RELEASE_APPROVAL", "MILESTONE_EVALUATION", "JOB_SUBMISSION", "JOB_EVALUATION", "JOB_REJECTION"]);
const ApprovalRecordBaseSchema = z.object({ id: Id, aggregateId: Id, intentId: Id, exactIntentHash: Hash, idempotencyKey: Id, decision: z.enum(["PENDING", "APPROVED", "REJECTED"]), approver: ActorSchema.nullable(), expiresAt: Time, decidedAt: Time.nullable() });
export const ApprovalRecordSchema = z.discriminatedUnion("actionKind", [
  ApprovalRecordBaseSchema.extend({ actionKind: z.literal("RELEASE_APPROVAL"), authorizedActorType: z.literal("FOUNDER"), authorizedActorId: Id }),
  ApprovalRecordBaseSchema.extend({ actionKind: z.literal("MILESTONE_EVALUATION"), authorizedActorType: z.literal("EVALUATOR"), authorizedActorId: Id }),
  ApprovalRecordBaseSchema.extend({ actionKind: z.literal("JOB_SUBMISSION"), authorizedActorType: z.literal("PROVIDER"), authorizedActorId: Id }),
  ApprovalRecordBaseSchema.extend({ actionKind: z.literal("JOB_EVALUATION"), authorizedActorType: z.literal("EVALUATOR"), authorizedActorId: Id }),
  ApprovalRecordBaseSchema.extend({ actionKind: z.literal("JOB_REJECTION"), authorizedActorType: z.enum(["FOUNDER", "EVALUATOR"]), authorizedActorId: Id }),
]).superRefine((value, context) => {
  if (value.decision === "PENDING" && (value.approver !== null || value.decidedAt !== null)) context.addIssue({ code: "custom", message: "Pending approval cannot contain a completed approver or decision timestamp." });
  if (value.decision !== "PENDING" && (value.approver === null || value.approver.actorType !== value.authorizedActorType || value.approver.actorId !== value.authorizedActorId || value.decidedAt === null)) context.addIssue({ code: "custom", message: "Completed approval requires the exact authorized actor and decision timestamp." });
  if (value.decision !== "PENDING" && value.decidedAt !== null && Date.parse(value.decidedAt) > Date.parse(value.expiresAt)) context.addIssue({ code: "custom", message: "Approval decision cannot occur after expiration." });
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;
export const AuditEventSchema = z.object({ id: Id, aggregateType: z.string().min(1), aggregateId: Id, eventType: z.string().min(1), actor: ActorSchema, idempotencyKey: Id.nullable(), occurredAt: Time, details: z.record(z.string(), z.union([z.string(), z.boolean(), z.null()])) });
export type AuditEvent = z.infer<typeof AuditEventSchema>;

const RequirementBaseSchema = z.object({ id: Id, milestoneId: Id, description: z.string().min(1), required: z.boolean().optional() });
export const MilestoneRequirementSchema = z.discriminatedUnion("kind", [
  RequirementBaseSchema.extend({ kind: z.literal("DELIVERABLE"), requiredCount: z.never().optional(), spendLimit: z.never().optional() }),
  RequirementBaseSchema.extend({ kind: z.literal("EXPENSE_RECORDS"), requiredCount: z.number().int().positive(), spendLimit: z.never().optional() }),
  RequirementBaseSchema.extend({ kind: z.literal("SPEND_LIMIT"), requiredCount: z.never().optional(), spendLimit: SettlementMoneyAmountSchema }),
  RequirementBaseSchema.extend({ kind: z.literal("FOUNDER_CONFIRMATION"), requiredCount: z.never().optional(), spendLimit: z.never().optional() }),
  RequirementBaseSchema.extend({ kind: z.literal("TRANSACTION_MATCH"), requiredCount: z.never().optional(), spendLimit: z.never().optional() }),
  RequirementBaseSchema.extend({ kind: z.literal("BUSINESS_PURPOSE"), requiredCount: z.never().optional(), spendLimit: z.never().optional() }),
  RequirementBaseSchema.extend({ kind: z.literal("DUE_DATE"), requiredCount: z.never().optional(), spendLimit: z.never().optional() }),
  RequirementBaseSchema.extend({ kind: z.literal("HUMAN_APPROVAL"), requiredCount: z.never().optional(), spendLimit: z.never().optional() }),
]);
export type MilestoneRequirement = z.infer<typeof MilestoneRequirementSchema>;
export const MilestoneSchema = z.object({ id: Id, projectId: Id, title: z.string().min(1), proposedAmount: SettlementMoneyAmountSchema, status: z.enum(["INCOMPLETE", "NEEDS_REVIEW", "ELIGIBLE", "APPROVAL_PENDING", "APPROVED", "REJECTED"]), requirementIds: z.array(Id), dueAt: Time.nullable() });
export type Milestone = z.infer<typeof MilestoneSchema>;
export const EvidenceItemSchema = z.object({ id: Id, projectId: Id, kind: z.enum(["RECEIPT", "SCREENSHOT", "INVOICE", "DELIVERABLE", "STATEMENT", "CONFIRMATION"]), sourceHash: Hash, storageRef: z.string().min(1), visibility: z.literal("FOUNDER_PRIVATE"), submittedAt: Time });
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
const EvidenceMatchBaseSchema = z.object({ id: Id, evidenceId: Id, requirementId: Id, confidenceBasisPoints: z.number().int().min(0).max(10_000).nullable(), explanation: z.string() });
const HumanEvidenceDecisionActorSchema = ActorSchema.refine(
  (actor) => actor.actorType === "FOUNDER" || actor.actorType === "EVALUATOR",
  "Human evidence decisions require an authorized founder or evaluator.",
);
export const EvidenceMatchSchema = z.discriminatedUnion("source", [
  EvidenceMatchBaseSchema.extend({ source: z.literal("AI_SUGGESTION"), acceptedBy: z.null() }),
  EvidenceMatchBaseSchema.extend({
    source: z.literal("HUMAN_DECISION"),
    acceptedEvidenceHash: Hash,
    acceptedBy: HumanEvidenceDecisionActorSchema,
  }),
]);
export type EvidenceMatch = z.infer<typeof EvidenceMatchSchema>;
export const ProofGapSchema = z.object({ id: Id, milestoneId: Id, requirementId: Id, reasonCode: z.string().min(1), question: z.string().min(1), priority: z.number().int().nonnegative(), resolvedAt: Time.nullable() });
export type ProofGap = z.infer<typeof ProofGapSchema>;
export const ProofOfProgressSchema = z.object({ id: Id, projectId: Id, milestoneId: Id, version: z.number().int().positive(), approvedEvidenceHashes: z.array(Hash), recordHash: Hash, visibility: VisibilitySchema, createdAt: Time });
export type ProofOfProgress = z.infer<typeof ProofOfProgressSchema>;
export const ReleaseRequestSchema = z.object({ id: Id, projectId: Id, milestoneId: Id, proofId: Id, intentId: Id, settlementId: Id.nullable(), amount: SettlementMoneyAmountSchema, state: z.enum(["DRAFT", "ELIGIBLE", "APPROVAL_PENDING", "APPROVED", "PREPARED", "SUBMITTED", "CONFIRMED", "RECONCILED", "REJECTED", "FAILED"]), approvalId: Id.nullable(), idempotencyKey: Id, createdAt: Time }).superRefine((value, context) => {
  if (["APPROVED", "PREPARED", "SUBMITTED", "CONFIRMED", "RECONCILED", "FAILED"].includes(value.state) && value.approvalId === null) context.addIssue({ code: "custom", message: `${value.state} release requires a persisted approval.` });
  if (["DRAFT", "ELIGIBLE", "APPROVAL_PENDING"].includes(value.state) && value.approvalId !== null) context.addIssue({ code: "custom", message: `${value.state} release cannot claim completed approval.` });
  if (["CONFIRMED", "RECONCILED"].includes(value.state) ? value.settlementId === null : value.settlementId !== null) context.addIssue({ code: "custom", message: "Release settlement reference must exist only in CONFIRMED or RECONCILED state." });
});
export type ReleaseRequest = z.infer<typeof ReleaseRequestSchema>;
export const SettlementRecordSchema = z.object({ id: Id, projectId: Id, releaseRequestId: Id, reconciliationId: Id.nullable(), idempotencyKey: Id, amount: SettlementMoneyAmountSchema, state: z.enum(["PENDING", "CONFIRMED", "REFUND_PENDING", "REFUNDED", "RECONCILED", "FAILED"]), job: AgenticJobRefSchema.nullable(), transaction: ArcTransactionRefSchema.nullable(), updatedAt: Time }).superRefine((value, context) => {
  const transaction = value.transaction;
  const jobTransaction = value.job?.transaction ?? null;
  const transactionMatchesJob = transaction !== null && jobTransaction !== null &&
    jobTransaction.network === transaction.network &&
    jobTransaction.chainId === transaction.chainId &&
    jobTransaction.transactionHash === transaction.transactionHash &&
    jobTransaction.status === transaction.status &&
    jobTransaction.blockNumber === transaction.blockNumber &&
    jobTransaction.blockHash === transaction.blockHash &&
    jobTransaction.explorerUrl === transaction.explorerUrl &&
    jobTransaction.operationType === transaction.operationType &&
    jobTransaction.isMock === transaction.isMock;
  const completionSettlementEligible = value.job?.status === "COMPLETED" && transaction?.operationType === "JOB_EVALUATE" && transactionMatchesJob;
  const rejectionRefundEligible = value.job?.status === "REJECTED" && value.job.escrowTransaction !== null && transaction?.operationType === "JOB_REJECT" && transactionMatchesJob;
  const expiredRefundEligible = value.job?.status === "EXPIRED" && value.job.escrowTransaction !== null && transaction?.operationType === "REFUND" && transactionMatchesJob;
  const genericSettlementEligible = value.job === null && transaction?.operationType === "SETTLEMENT";
  const genericRefundEligible = value.job === null && transaction?.operationType === "REFUND";
  const pendingJobEligible = value.job === null || !["COMPLETED", "REJECTED", "EXPIRED"].includes(value.job.status);
  const pendingTransactionMatchesJob = transaction !== null && jobTransaction !== null &&
    jobTransaction.status === "CONFIRMED" &&
    jobTransaction.network === transaction.network &&
    jobTransaction.chainId === transaction.chainId &&
    jobTransaction.isMock === transaction.isMock &&
    ["PREPARED", "SUBMITTED"].includes(transaction.status);
  const pendingCompletionEligible =
    value.job?.status === "SUBMITTED" &&
    jobTransaction?.operationType === "JOB_SUBMIT" &&
    transaction?.operationType === "JOB_EVALUATE" &&
    pendingTransactionMatchesJob;
  const pendingRejectionEligible =
    (value.job?.status === "FUNDED" || value.job?.status === "SUBMITTED") &&
    (jobTransaction?.operationType === "JOB_FUND" || jobTransaction?.operationType === "JOB_SUBMIT") &&
    transaction?.operationType === "JOB_REJECT" &&
    pendingTransactionMatchesJob;
  const allowed =
    (value.state === "PENDING" && ((transaction === null && pendingJobEligible) || (genericSettlementEligible && ["PREPARED", "SUBMITTED"].includes(transaction.status)) || pendingCompletionEligible)) ||
    (value.state === "CONFIRMED" && transaction?.status === "CONFIRMED" && (genericSettlementEligible || completionSettlementEligible)) ||
    (value.state === "REFUND_PENDING" && ((transaction === null && pendingJobEligible) || (genericRefundEligible && ["PREPARED", "SUBMITTED"].includes(transaction.status)) || pendingRejectionEligible)) ||
    (value.state === "REFUNDED" && transaction?.status === "CONFIRMED" && (genericRefundEligible || expiredRefundEligible || rejectionRefundEligible)) ||
    (value.state === "RECONCILED" && transaction?.status === "CONFIRMED" && (genericSettlementEligible || completionSettlementEligible || genericRefundEligible || expiredRefundEligible || rejectionRefundEligible)) ||
    (value.state === "FAILED" && ((transaction === null && pendingJobEligible) || (value.job === null && transaction?.status === "FAILED" && (transaction.operationType === "SETTLEMENT" || transaction.operationType === "REFUND"))));
  if (!allowed) context.addIssue({ code: "custom", message: `${value.state} settlement requires compatible persisted transaction evidence.` });
  if (value.job !== null && (value.job.budget.asset !== value.amount.asset || value.job.budget.atomicUnits !== value.amount.atomicUnits)) context.addIssue({ code: "custom", message: "Job-backed settlement amount must match the ERC-8183 job budget exactly." });
  if (value.job !== null && transaction?.status === "CONFIRMED") {
    if (transaction.operationType === "SETTLEMENT") context.addIssue({ code: "custom", message: "Job-backed completion must use the completed job's exact JOB_EVALUATE transaction." });
    if (transaction.operationType === "JOB_EVALUATE" && !completionSettlementEligible) context.addIssue({ code: "custom", message: "Confirmed evaluation settlement must match the completed job's exact Arc transaction evidence." });
    if (transaction.operationType === "REFUND" && !expiredRefundEligible) context.addIssue({ code: "custom", message: "Job-backed REFUND evidence is reserved for the exact expired-job refund write." });
    if (transaction.operationType === "JOB_REJECT" && !rejectionRefundEligible) context.addIssue({ code: "custom", message: "Confirmed rejection refund must match the rejected job's exact Arc transaction evidence." });
  }
  if (value.state === "RECONCILED" ? value.reconciliationId === null : value.reconciliationId !== null) context.addIssue({ code: "custom", message: "Settlement reconciliation reference must match RECONCILED state." });
});
export type SettlementRecord = z.infer<typeof SettlementRecordSchema>;
const DestinationProtocolTargetSchema = z.object({
  kind: z.literal("DESTINATION"),
  destination: Id,
  network: z.literal(ARC_TESTNET_NETWORK),
  chainId: Id,
  isMock: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.isMock && (!isSynthetic(value.destination) || !isSynthetic(value.chainId))) context.addIssue({ code: "custom", message: "Mock destination intents require visibly synthetic destination and chain references." });
  if (!value.isMock && (!EvmAddress.test(value.destination) || value.chainId !== ARC_TESTNET_CHAIN_ID)) context.addIssue({ code: "custom", message: "Live destination intents require a canonical EVM recipient on Arc Testnet." });
});
const Erc8183ProtocolTargetSchema = z.object({
  kind: z.literal("ERC8183"), standard: z.literal("ERC-8183"), network: z.literal(ARC_TESTNET_NETWORK), chainId: Id.refine(isSynthetic),
  contractReference: Id.refine(isSynthetic, "Issue #2 ERC-8183 contract references must be visibly synthetic."), jobId: Id.refine(isSynthetic, "Issue #2 job IDs must be visibly synthetic."),
  method: z.enum(["JOB_FUND", "JOB_SUBMIT", "JOB_EVALUATE", "JOB_REJECT", "CLAIM_REFUND"]), parameterCommitment: Hash,
  clientReference: Id.refine(isSynthetic), providerReference: Id.refine(isSynthetic), evaluatorReference: Id.refine(isSynthetic), destination: Id.refine(isSynthetic),
}).strict();
export const ProtocolTargetSchema = z.discriminatedUnion("kind", [DestinationProtocolTargetSchema, Erc8183ProtocolTargetSchema]);
export const CanonicalExecutionIntentSchema = z.object({ version: z.literal(1), actionKind: ApprovalActionKindSchema, projectId: Id, releaseRequestId: Id, transactionRecordId: Id, intentId: Id, asset: z.literal(LAUNCHVAULT_SETTLEMENT_ASSET), atomicAmount: AtomicUnitsSchema, operationType: TransactionOperationTypeSchema, protocolTarget: ProtocolTargetSchema }).superRefine((value, context) => {
  const supportedActionPolicy = { SETTLEMENT: "RELEASE_APPROVAL", REFUND: "RELEASE_APPROVAL", JOB_FUND: "RELEASE_APPROVAL", JOB_SUBMIT: "JOB_SUBMISSION", JOB_EVALUATE: "JOB_EVALUATION", JOB_REJECT: "JOB_REJECTION" } as const;
  const isJobOperation = ["JOB_FUND", "JOB_SUBMIT", "JOB_EVALUATE", "JOB_REJECT"].includes(value.operationType);
  const usesErc8183Target = value.protocolTarget.kind === "ERC8183";
  if ((isJobOperation && !usesErc8183Target) || (usesErc8183Target && !isJobOperation && value.operationType !== "REFUND")) context.addIssue({ code: "custom", message: "Execution operation and protocol target are incompatible." });
  const expectedActionKind = supportedActionPolicy[value.operationType as keyof typeof supportedActionPolicy];
  if (expectedActionKind === undefined) context.addIssue({ code: "custom", message: `${value.operationType} execution authorization is deferred to its owning issue.` });
  else if (value.actionKind !== expectedActionKind) context.addIssue({ code: "custom", message: `${value.operationType} requires ${expectedActionKind} authorization.` });
  if (value.protocolTarget.kind === "ERC8183") {
    const expectedMethod = value.operationType === "REFUND" ? "CLAIM_REFUND" : isJobOperation ? value.operationType : null;
    if (expectedMethod === null || value.protocolTarget.method !== expectedMethod) context.addIssue({ code: "custom", message: "ERC-8183 execution method must match the supported operation type." });
  }
});
export type CanonicalExecutionIntent = z.infer<typeof CanonicalExecutionIntentSchema>;
export const ExecutionAuthorizationBindingSchema = z.object({ id: Id, releaseRequestId: Id, approvalId: Id, intentId: Id, exactIntentHash: Hash, transactionRecordId: Id, executionIntent: CanonicalExecutionIntentSchema, status: z.enum(["ACTIVE", "CONSUMED", "REVOKED"]), consumedAt: Time.nullable(), consumedByTransactionId: Id.nullable(), createdAt: Time }).superRefine((value, context) => {
  if (value.status === "CONSUMED" ? value.consumedAt === null || value.consumedByTransactionId === null : value.consumedAt !== null || value.consumedByTransactionId !== null) context.addIssue({ code: "custom", message: "Binding consumption evidence must match its status." });
});
export type ExecutionAuthorizationBinding = z.infer<typeof ExecutionAuthorizationBindingSchema>;
export const ReconciliationRecordSchema = z.object({ id: Id, projectId: Id, transactionRecordId: Id, settlementId: Id, result: z.enum(["MATCHED", "MISMATCH", "REQUIRES_REVIEW"]), evidenceReference: z.string().min(1), reconciledAt: Time, actor: z.object({ actorId: Id, actorType: z.literal("ADAPTER") }) });
export type ReconciliationRecord = z.infer<typeof ReconciliationRecordSchema>;
export const AllocationOperationRecordSchema = z.object({ id: Id, reserveId: Id, idempotencyKey: Id, amount: SettlementMoneyAmountSchema, createdAt: Time });
export type AllocationOperationRecord = z.infer<typeof AllocationOperationRecordSchema>;
export const SubmissionOperationRecordSchema = z.object({ id: Id, transactionId: Id, idempotencyKey: Id, arcTransaction: ArcTransactionRefSchema, createdAt: Time });
export type SubmissionOperationRecord = z.infer<typeof SubmissionOperationRecordSchema>;
export const JobRefundOperationRecordSchema = z.object({ id: Id, jobId: Id, transactionId: Id, idempotencyKey: Id, arcTransaction: ArcTransactionRefSchema, createdAt: Time }).superRefine((value, context) => {
  if (value.arcTransaction.operationType !== "REFUND" || value.arcTransaction.status !== "CONFIRMED") context.addIssue({ code: "custom", message: "Job refund operation requires a confirmed REFUND transaction." });
});
export type JobRefundOperationRecord = z.infer<typeof JobRefundOperationRecordSchema>;
export const JobEvaluationEvidenceSchema = z.object({ id: Id, jobId: Id, approvalId: Id, intentId: Id, exactIntentHash: Hash, decision: z.enum(["APPROVED", "REJECTED"]), transactionHash: z.string().min(1), transactionNetwork: z.literal(ARC_TESTNET_NETWORK), transactionChainId: z.string().min(1) });
export type JobEvaluationEvidence = z.infer<typeof JobEvaluationEvidenceSchema>;
export const RecoveryOperationRecordSchema = z.object({ id: Id, proofGapId: Id, idempotencyKey: Id, responseReference: z.string().min(1), createdAt: Time });
export type RecoveryOperationRecord = z.infer<typeof RecoveryOperationRecordSchema>;
export const DisclosurePreferencesSchema = z.object({ projectId: Id, discloseCapitalSummary: z.boolean(), discloseRequirementOutcomes: z.boolean(), discloseProofRecords: z.boolean(), discloseSettlementState: z.boolean(), approvedProofIds: z.array(Id), updatedAt: Time });
export type DisclosurePreferences = z.infer<typeof DisclosurePreferencesSchema>;
