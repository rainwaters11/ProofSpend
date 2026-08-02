import { z } from "zod";
import { MoneyAmountSchema } from "./money";

const Id = z.string().min(1);
const Time = z.string().datetime();
const Hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const VisibilitySchema = z.enum(["FOUNDER_PRIVATE", "BACKER_SHARED", "ONCHAIN_PUBLIC"]);
export const ActorSchema = z.object({ actorId: Id, actorType: z.enum(["SYSTEM", "AI", "FOUNDER", "BACKER", "EVALUATOR", "ADAPTER"]) });
export type Actor = z.infer<typeof ActorSchema>;

export const AgenticJobStatusSchema = z.enum(["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"]);
export type AgenticJobStatus = z.infer<typeof AgenticJobStatusSchema>;
export const AgentIdentityRefSchema = z.object({
  standard: z.literal("ERC-8004"), chainId: z.string().min(1), registryAddress: z.string().min(1),
  agentId: z.string().min(1), ownerAddress: z.string().min(1), registrationTransactionHash: z.string().min(1).nullable(),
  registrationStatus: z.enum(["UNREGISTERED", "PENDING", "REGISTERED"]), isMock: z.boolean(),
});
export type AgentIdentityRef = z.infer<typeof AgentIdentityRefSchema>;
export const AgentReputationRefSchema = z.object({
  standard: z.literal("ERC-8004"), chainId: z.string().min(1), registryAddress: z.string().min(1), agentId: z.string().min(1),
  reputationId: z.string().min(1), writerAddress: z.string().min(1), agentOwnerAddress: z.string().min(1),
  value: z.string().min(1), transactionHash: z.string().min(1).nullable(), recordedAt: Time.nullable(), isMock: z.boolean(),
}).refine(
  (value: { writerAddress: string; agentOwnerAddress: string }) => value.writerAddress !== value.agentOwnerAddress,
  "Agent owner cannot write its own reputation.",
);
export type AgentReputationRef = z.infer<typeof AgentReputationRefSchema>;
export const ArcTransactionRefSchema = z.object({
  chain: z.literal("ARC_TESTNET"), chainId: z.string().min(1), transactionHash: z.string().min(1).nullable(),
  status: z.enum(["NONE", "PREPARED", "SUBMITTED", "CONFIRMED", "FAILED"]), blockNumber: z.string().regex(/^\d+$/).nullable(),
  explorerUrl: z.string().url().nullable(), isMock: z.boolean(),
});
export type ArcTransactionRef = z.infer<typeof ArcTransactionRefSchema>;
export const AgenticJobRefSchema = z.object({
  standard: z.literal("ERC-8183"), chainId: z.string().min(1), contractAddress: z.string().min(1), jobId: z.string().min(1),
  clientAddress: z.string().min(1), providerAddress: z.string().min(1), evaluatorAddress: z.string().min(1),
  status: AgenticJobStatusSchema, deliverableHash: Hash.nullable(), transaction: ArcTransactionRefSchema.nullable(), isMock: z.boolean(),
});
export type AgenticJobRef = z.infer<typeof AgenticJobRefSchema>;

export const ProjectSchema = z.object({ id: Id, name: z.string().min(1), founderId: Id, description: z.string(), createdAt: Time });
export type Project = z.infer<typeof ProjectSchema>;
export const BackerSchema = z.object({ id: Id, projectId: Id, displayName: z.string().min(1), createdAt: Time });
export type Backer = z.infer<typeof BackerSchema>;
export const LaunchVaultSchema = z.object({ id: Id, projectId: Id, asset: z.string().min(1), totalCapital: MoneyAmountSchema, mode: z.enum(["MOCK", "ARC_TESTNET"]), createdAt: Time });
export type LaunchVault = z.infer<typeof LaunchVaultSchema>;
export const ReserveSchema = z.object({ id: Id, vaultId: Id, name: z.string().min(1), allocated: MoneyAmountSchema, status: z.enum(["PROPOSED", "ACTIVE", "CLOSED"]) });
export type Reserve = z.infer<typeof ReserveSchema>;
export const AllocationRuleSchema = z.object({ id: Id, reserveId: Id, purpose: z.string().min(1), maximum: MoneyAmountSchema, requiresApproval: z.boolean() });
export type AllocationRule = z.infer<typeof AllocationRuleSchema>;
export const LedgerEntrySchema = z.object({ id: Id, vaultId: Id, reserveId: Id.nullable(), kind: z.enum(["CAPITAL", "ALLOCATION", "COMMITMENT", "SETTLEMENT", "REFUND", "REVERSAL"]), amount: MoneyAmountSchema, reversesEntryId: Id.nullable(), idempotencyKey: Id, occurredAt: Time });
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export const TransactionRecordSchema = z.object({ id: Id, intentId: Id, idempotencyKey: Id, amount: MoneyAmountSchema, operationState: z.enum(["INTENT_PERSISTED", "PREPARED", "SUBMITTED", "CONFIRMED", "FAILED", "RECONCILED"]), arcTransaction: ArcTransactionRefSchema.nullable(), createdAt: Time, updatedAt: Time });
export type TransactionRecord = z.infer<typeof TransactionRecordSchema>;
export const ApprovalRecordSchema = z.object({ id: Id, actionType: z.string().min(1), exactIntentHash: Hash, decision: z.enum(["PENDING", "APPROVED", "REJECTED"]), approver: ActorSchema.nullable(), expiresAt: Time, decidedAt: Time.nullable() });
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;
export const AuditEventSchema = z.object({ id: Id, aggregateType: z.string().min(1), aggregateId: Id, eventType: z.string().min(1), actor: ActorSchema, idempotencyKey: Id.nullable(), occurredAt: Time, details: z.record(z.string(), z.union([z.string(), z.boolean(), z.null()])) });
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const MilestoneRequirementSchema = z.object({ id: Id, milestoneId: Id, kind: z.enum(["DELIVERABLE", "EXPENSE_RECORDS", "SPEND_LIMIT", "FOUNDER_CONFIRMATION"]), description: z.string().min(1), requiredCount: z.number().int().positive().optional(), spendLimit: MoneyAmountSchema.optional() });
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
export const ReleaseRequestSchema = z.object({ id: Id, milestoneId: Id, proofId: Id, amount: MoneyAmountSchema, state: z.enum(["DRAFT", "ELIGIBLE", "APPROVAL_PENDING", "APPROVED", "PREPARED", "SUBMITTED", "CONFIRMED", "REJECTED", "FAILED"]), approvalId: Id.nullable(), idempotencyKey: Id, createdAt: Time });
export type ReleaseRequest = z.infer<typeof ReleaseRequestSchema>;
export const SettlementRecordSchema = z.object({ id: Id, releaseRequestId: Id, amount: MoneyAmountSchema, state: z.enum(["PENDING", "CONFIRMED", "REFUND_PENDING", "REFUNDED", "RECONCILED", "FAILED"]), job: AgenticJobRefSchema.nullable(), transaction: ArcTransactionRefSchema.nullable(), updatedAt: Time });
export type SettlementRecord = z.infer<typeof SettlementRecordSchema>;
export const DisclosurePreferencesSchema = z.object({ projectId: Id, discloseCapitalSummary: z.boolean(), discloseRequirementOutcomes: z.boolean(), discloseProofRecords: z.boolean(), discloseSettlementState: z.boolean(), approvedProofIds: z.array(Id), updatedAt: Time });
export type DisclosurePreferences = z.infer<typeof DisclosurePreferencesSchema>;
