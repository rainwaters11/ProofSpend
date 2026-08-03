import { z } from "zod";
import { MoneyAmountSchema } from "./money";
import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_NETWORK, arcTestnetExplorerTransactionUrl } from "./network";

const Id = z.string().min(1);
const Time = z.string().datetime();
const Hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const EvmAddress = /^0x[a-fA-F0-9]{40}$/;
const EvmHash = /^0x[a-fA-F0-9]{64}$/;
const isSynthetic = (value: string) => /^(mock:|synthetic:)/.test(value);
export const VisibilitySchema = z.enum(["FOUNDER_PRIVATE", "BACKER_SHARED", "ONCHAIN_PUBLIC"]);
export const ActorSchema = z.object({ actorId: Id, actorType: z.enum(["SYSTEM", "AI", "FOUNDER", "BACKER", "EVALUATOR", "ADAPTER"]) });
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
  if (value.isMock && [value.network, value.chainId, value.registryAddress, value.agentId, value.writerAddress, value.agentOwnerAddress, value.eventReference].some((item) => !isSynthetic(item))) context.addIssue({ code: "custom", message: "Every mock reputation reference must be visibly synthetic." });
  if (!value.isMock && [value.network, value.chainId, value.registryAddress, value.agentId, value.eventReference].some(isSynthetic)) context.addIssue({ code: "custom", message: "Synthetic reputation references cannot be marked live." });
  if (!value.isMock && (!EvmAddress.test(value.writerAddress) || !EvmAddress.test(value.agentOwnerAddress))) context.addIssue({ code: "custom", message: "Live reputation owner and writer must be EVM addresses." });
});
export type AgentReputationRef = z.infer<typeof AgentReputationRefSchema>;
export const ArcTransactionRefSchema = z.object({
  network: z.literal(ARC_TESTNET_NETWORK), chainId: z.string().min(1), transactionHash: z.string().min(1).nullable(),
  status: z.enum(["NONE", "PREPARED", "SUBMITTED", "CONFIRMED", "FAILED"]), blockNumber: z.string().regex(/^\d+$/).nullable(),
  blockHash: z.string().min(1).nullable(), explorerUrl: z.string().url().nullable(),
  operationType: z.enum(["IDENTITY_REGISTRATION", "REPUTATION_WRITE", "JOB_CREATE", "JOB_FUND", "JOB_SUBMIT", "JOB_EVALUATE", "SETTLEMENT", "REFUND"]), isMock: z.boolean(),
}).superRefine((value, context) => {
  if (["NONE", "PREPARED"].includes(value.status) && (value.transactionHash !== null || value.blockNumber !== null || value.blockHash !== null || value.explorerUrl !== null)) context.addIssue({ code: "custom", message: `${value.status} transaction cannot contain transaction or block evidence.` });
  if (value.status === "SUBMITTED" && value.transactionHash === null) context.addIssue({ code: "custom", message: "Submitted transaction requires a transaction hash." });
  if (value.status === "SUBMITTED" && (value.blockNumber !== null || value.blockHash !== null)) context.addIssue({ code: "custom", message: "Submitted transaction cannot contain confirmation block evidence." });
  if (value.status === "CONFIRMED" && (value.transactionHash === null || value.blockNumber === null || value.blockHash === null)) context.addIssue({ code: "custom", message: "Confirmed transaction requires transaction hash, block number, and block hash." });
  if (value.status === "FAILED" && (value.blockNumber !== null || value.blockHash !== null)) context.addIssue({ code: "custom", message: "Failed transaction cannot contain confirmation block evidence." });
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
  budget: MoneyAmountSchema, expiresAt: Time, descriptionReference: z.string().min(1), deliverableReference: z.string().min(1).nullable(),
  reasonReference: z.string().min(1).nullable(), status: AgenticJobStatusSchema, transaction: ArcTransactionRefSchema.nullable(), isMock: z.boolean(),
}).superRefine((value, context) => {
  const references = [value.network, value.chainId, value.contractAddress, value.jobId, value.clientAddress, value.providerAddress, value.evaluatorAddress, value.descriptionReference, value.deliverableReference, value.reasonReference].filter((item): item is string => item !== null);
  if (value.isMock && references.some((item) => !isSynthetic(item))) context.addIssue({ code: "custom", message: "Every mock job reference must be visibly synthetic." });
  if (!value.isMock && references.some(isSynthetic)) context.addIssue({ code: "custom", message: "Synthetic job references cannot be marked live." });
  if (value.transaction !== null && value.transaction.isMock !== value.isMock) context.addIssue({ code: "custom", message: "Job and transaction mock/live indicators must match." });
});
export type AgenticJobRef = z.infer<typeof AgenticJobRefSchema>;

export const ProjectSchema = z.object({ id: Id, name: z.string().min(1), founderId: Id, description: z.string(), createdAt: Time });
export type Project = z.infer<typeof ProjectSchema>;
export const BackerSchema = z.object({ id: Id, projectId: Id, displayName: z.string().min(1), createdAt: Time });
export type Backer = z.infer<typeof BackerSchema>;
export const LaunchVaultSchema = z.object({ id: Id, projectId: Id, asset: z.string().min(1), totalCapital: MoneyAmountSchema, mode: z.enum(["MOCK", "ARC_TESTNET"]), createdAt: Time }).refine((value) => value.asset === value.totalCapital.asset, "Vault and total capital assets must match.");
export type LaunchVault = z.infer<typeof LaunchVaultSchema>;
export const ReserveSchema = z.object({ id: Id, vaultId: Id, name: z.string().min(1), allocated: MoneyAmountSchema, status: z.enum(["PROPOSED", "ACTIVE", "CLOSED"]) });
export type Reserve = z.infer<typeof ReserveSchema>;
export const AllocationRuleSchema = z.object({ id: Id, reserveId: Id, purpose: z.string().min(1), maximum: MoneyAmountSchema, requiresApproval: z.boolean() });
export type AllocationRule = z.infer<typeof AllocationRuleSchema>;
export const LedgerEntrySchema = z.object({ id: Id, vaultId: Id, reserveId: Id.nullable(), kind: z.enum(["CAPITAL", "ALLOCATION", "COMMITMENT", "SETTLEMENT", "REFUND", "REVERSAL"]), amount: MoneyAmountSchema, reversesEntryId: Id.nullable(), idempotencyKey: Id, occurredAt: Time });
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export const TransactionRecordSchema = z.object({ id: Id, intentId: Id, idempotencyKey: Id, amount: MoneyAmountSchema, operationState: z.enum(["INTENT_PERSISTED", "PREPARED", "SUBMITTED", "CONFIRMED", "FAILED", "RECONCILED"]), arcTransaction: ArcTransactionRefSchema.nullable(), createdAt: Time, updatedAt: Time }).superRefine((value, context) => {
  const compatible: Record<typeof value.operationState, readonly ArcTransactionRef["status"][]> = { INTENT_PERSISTED: ["NONE"], PREPARED: ["PREPARED"], SUBMITTED: ["SUBMITTED"], CONFIRMED: ["CONFIRMED"], FAILED: ["FAILED"], RECONCILED: ["CONFIRMED"] };
  if (value.operationState === "INTENT_PERSISTED" && value.arcTransaction === null) return;
  const allowed: readonly ArcTransactionRef["status"][] = compatible[value.operationState];
  if (value.arcTransaction === null || !allowed.includes(value.arcTransaction.status)) context.addIssue({ code: "custom", message: `${value.operationState} transaction record requires compatible lifecycle evidence.` });
});
export type TransactionRecord = z.infer<typeof TransactionRecordSchema>;
export const ApprovalRecordSchema = z.object({ id: Id, actionType: z.string().min(1), exactIntentHash: Hash, idempotencyKey: Id, decision: z.enum(["PENDING", "APPROVED", "REJECTED"]), approver: ActorSchema.nullable(), expiresAt: Time, decidedAt: Time.nullable() }).superRefine((value, context) => {
  if (value.decision === "PENDING" && (value.approver !== null || value.decidedAt !== null)) context.addIssue({ code: "custom", message: "Pending approval cannot contain a completed approver or decision timestamp." });
  if (value.decision !== "PENDING" && (value.approver === null || !(value.approver.actorType === "FOUNDER" || value.approver.actorType === "EVALUATOR") || value.decidedAt === null)) context.addIssue({ code: "custom", message: "Completed approval requires a founder or evaluator and decision timestamp." });
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;
export const AuditEventSchema = z.object({ id: Id, aggregateType: z.string().min(1), aggregateId: Id, eventType: z.string().min(1), actor: ActorSchema, idempotencyKey: Id.nullable(), occurredAt: Time, details: z.record(z.string(), z.union([z.string(), z.boolean(), z.null()])) });
export type AuditEvent = z.infer<typeof AuditEventSchema>;

const RequirementBaseSchema = z.object({ id: Id, milestoneId: Id, description: z.string().min(1) });
export const MilestoneRequirementSchema = z.discriminatedUnion("kind", [
  RequirementBaseSchema.extend({ kind: z.literal("DELIVERABLE"), requiredCount: z.never().optional(), spendLimit: z.never().optional() }),
  RequirementBaseSchema.extend({ kind: z.literal("EXPENSE_RECORDS"), requiredCount: z.number().int().positive(), spendLimit: z.never().optional() }),
  RequirementBaseSchema.extend({ kind: z.literal("SPEND_LIMIT"), requiredCount: z.never().optional(), spendLimit: MoneyAmountSchema }),
  RequirementBaseSchema.extend({ kind: z.literal("FOUNDER_CONFIRMATION"), requiredCount: z.never().optional(), spendLimit: z.never().optional() }),
]);
export type MilestoneRequirement = z.infer<typeof MilestoneRequirementSchema>;
export const MilestoneSchema = z.object({ id: Id, projectId: Id, title: z.string().min(1), proposedAmount: MoneyAmountSchema, status: z.enum(["INCOMPLETE", "NEEDS_REVIEW", "ELIGIBLE", "APPROVAL_PENDING", "APPROVED", "REJECTED"]), requirementIds: z.array(Id), dueAt: Time.nullable() });
export type Milestone = z.infer<typeof MilestoneSchema>;
export const EvidenceItemSchema = z.object({ id: Id, projectId: Id, kind: z.enum(["RECEIPT", "SCREENSHOT", "INVOICE", "DELIVERABLE", "STATEMENT", "CONFIRMATION"]), sourceHash: Hash, storageRef: z.string().min(1), visibility: z.literal("FOUNDER_PRIVATE"), submittedAt: Time });
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export const EvidenceMatchSchema = z.object({ id: Id, evidenceId: Id, requirementId: Id, source: z.enum(["AI_SUGGESTION", "HUMAN_DECISION"]), confidenceBasisPoints: z.number().int().min(0).max(10_000).nullable(), explanation: z.string(), acceptedBy: ActorSchema.nullable() });
export type EvidenceMatch = z.infer<typeof EvidenceMatchSchema>;
export const ProofGapSchema = z.object({ id: Id, milestoneId: Id, requirementId: Id, reasonCode: z.string().min(1), question: z.string().min(1), priority: z.number().int().nonnegative(), resolvedAt: Time.nullable() });
export type ProofGap = z.infer<typeof ProofGapSchema>;
export const ProofOfProgressSchema = z.object({ id: Id, milestoneId: Id, version: z.number().int().positive(), approvedEvidenceHashes: z.array(Hash), recordHash: Hash, visibility: VisibilitySchema, createdAt: Time });
export type ProofOfProgress = z.infer<typeof ProofOfProgressSchema>;
export const ReleaseRequestSchema = z.object({ id: Id, milestoneId: Id, proofId: Id, amount: MoneyAmountSchema, state: z.enum(["DRAFT", "ELIGIBLE", "APPROVAL_PENDING", "APPROVED", "PREPARED", "SUBMITTED", "CONFIRMED", "REJECTED", "FAILED"]), approvalId: Id.nullable(), idempotencyKey: Id, createdAt: Time }).superRefine((value, context) => {
  if (["APPROVED", "PREPARED", "SUBMITTED", "CONFIRMED"].includes(value.state) && value.approvalId === null) context.addIssue({ code: "custom", message: `${value.state} release requires a persisted approval.` });
  if (["DRAFT", "ELIGIBLE", "APPROVAL_PENDING"].includes(value.state) && value.approvalId !== null) context.addIssue({ code: "custom", message: `${value.state} release cannot claim completed approval.` });
});
export type ReleaseRequest = z.infer<typeof ReleaseRequestSchema>;
export const SettlementRecordSchema = z.object({ id: Id, projectId: Id, releaseRequestId: Id, idempotencyKey: Id, amount: MoneyAmountSchema, state: z.enum(["PENDING", "CONFIRMED", "REFUND_PENDING", "REFUNDED", "RECONCILED", "FAILED"]), job: AgenticJobRefSchema.nullable(), transaction: ArcTransactionRefSchema.nullable(), updatedAt: Time }).superRefine((value, context) => {
  const transaction = value.transaction;
  const allowed =
    (value.state === "PENDING" && (transaction === null || (transaction.operationType === "SETTLEMENT" && ["PREPARED", "SUBMITTED"].includes(transaction.status)))) ||
    (value.state === "CONFIRMED" && transaction?.operationType === "SETTLEMENT" && transaction.status === "CONFIRMED") ||
    (value.state === "REFUND_PENDING" && (transaction === null || (transaction.operationType === "REFUND" && ["PREPARED", "SUBMITTED"].includes(transaction.status)))) ||
    (value.state === "REFUNDED" && transaction?.operationType === "REFUND" && transaction.status === "CONFIRMED") ||
    (value.state === "RECONCILED" && transaction?.status === "CONFIRMED" && (transaction.operationType === "SETTLEMENT" || transaction.operationType === "REFUND")) ||
    (value.state === "FAILED" && (transaction === null || transaction.status === "FAILED"));
  if (!allowed) context.addIssue({ code: "custom", message: `${value.state} settlement requires compatible persisted transaction evidence.` });
});
export type SettlementRecord = z.infer<typeof SettlementRecordSchema>;
export const AllocationOperationRecordSchema = z.object({ id: Id, reserveId: Id, idempotencyKey: Id, amount: MoneyAmountSchema, createdAt: Time });
export type AllocationOperationRecord = z.infer<typeof AllocationOperationRecordSchema>;
export const SubmissionOperationRecordSchema = z.object({ id: Id, transactionId: Id, idempotencyKey: Id, createdAt: Time });
export type SubmissionOperationRecord = z.infer<typeof SubmissionOperationRecordSchema>;
export const RecoveryOperationRecordSchema = z.object({ id: Id, proofGapId: Id, idempotencyKey: Id, responseReference: z.string().min(1), createdAt: Time });
export type RecoveryOperationRecord = z.infer<typeof RecoveryOperationRecordSchema>;
export const DisclosurePreferencesSchema = z.object({ projectId: Id, discloseCapitalSummary: z.boolean(), discloseRequirementOutcomes: z.boolean(), discloseProofRecords: z.boolean(), discloseSettlementState: z.boolean(), approvedProofIds: z.array(Id), updatedAt: Time });
export type DisclosurePreferences = z.infer<typeof DisclosurePreferencesSchema>;
