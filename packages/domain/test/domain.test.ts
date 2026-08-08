Warning: truncated output (original token count: 63693)
Total output lines: 2779

import { describe, expect, it } from "vitest";
import {
  addMoney, AgenticJobRefSchema, AgenticJobStatusSchema, AgentIdentityRefSchema, AgentReputationRefSchema,
  ARC_TESTNET_CHAIN_ID, arcTestnetExplorerTransactionUrl,
  AllocationOperationRecordSchema, AllocationRuleSchema, ApprovalRecordSchema, ArcTransactionRefSchema, CanonicalExecutionIntentSchema, compareMoney,
  createPawPovAiSeed, EvidenceItemSchema, EvidenceMatchSchema, ExecutionAuthorizationBindingSchema, filterBackerDisclosure, IdempotencyConflictError, JobEvaluationEvidenceSchema, InMemoryAuditRepository,
  ExecutionAuthorizationBindingRepository, InMemoryIdempotencyRepository, InMemoryRepository, InvalidTransitionError, LaunchVaultSchema, mapAgenticJobToApplication,
  LedgerEntrySchema, MilestoneRequirementSchema, MilestoneSchema, type ArcTransactionRef, type LedgerEntry,
  MockAgenticJobAdapter, MockIdentityAdapter, MockWalletReferenceAdapter, money, MoneyAmountSchema, MoneyError,
  RecoveryOperationRecordSchema, ReleaseRequestSchema, ReserveSchema, SettlementMoneyAmountSchema, SettlementRecordSchema, JobRefundOperationRecordSchema, SubmissionOperationRecordSchema, subtractMoney,
  LaunchVaultTreasury, TreasuryAllocationRoundingPolicy, TreasuryError, hashAllocationProposalIntent,
  ReconciliationRecordSchema, TransactionRecordSchema, transitionAgenticJob, transitionApplication, transitionApplicationSubmission,
  hashCanonicalExecutionIntent, hashJobParameterCommitment, serializeCanonicalExecutionIntent, validateExecutionAuthorization, validateLedgerReversal, validateReconciliation, validateReleaseConfirmation,
} from "../src";

type ReversalEntry = Extract<LedgerEntry, { kind: "REVERSAL" }>;

const context = { aggregateType: "milestone", aggregateId: "m1", eventId: "event:1", occurredAt: "2026-01-01T00:00:00.000Z", actor: { actorId: "system", actorType: "SYSTEM" as const } };
const usdc = (atomicUnits: string) => SettlementMoneyAmountSchema.parse({ asset: "USDC", atomicUnits });
const mockTransaction = (status: "NONE" | "PREPARED" | "SUBMITTED" | "CONFIRMED" | "FAILED", operationType: "SETTLEMENT" | "REFUND" | "JOB_FUND" | "JOB_SUBMIT" | "JOB_EVALUATE" | "JOB_REJECT" = "SETTLEMENT") => ({
  network: "ARC_TESTNET" as const, chainId: "synthetic:chain", transactionHash: status === "SUBMITTED" || status === "CONFIRMED" ? "mock:transaction" : null,
  status, blockNumber: status === "CONFIRMED" ? "1" : null, blockHash: status === "CONFIRMED" ? "mock:block" : null,
  explorerUrl: null, operationType, isMock: true,
});
const mockJob = (status: "OPEN" | "FUNDED" | "SUBMITTED" | "COMPLETED" | "REJECTED" | "EXPIRED", transaction: ArcTransactionRef | null = null, escrowTransaction: ArcTransactionRef | null = null) => AgenticJobRefSchema.parse({ standard: "ERC-8183", network: "mock:network", chainId: "mock:chain", contractAddress: "mock:contract", jobId: "mock:job", clientAddress: "mock:client", providerAddress: "mock:provider", evaluatorAddress: "mock:evaluator", budget: usdc("1"), expiresAt: "2026-02-01T00:00:00.000Z", descriptionReference: "mock:description", deliverableReference: ["SUBMITTED", "COMPLETED"].includes(status) || (["REJECTED", "EXPIRED"].includes(status) && escrowTransaction?.operationType === "JOB_SUBMIT") ? "mock:deliverable" : null, reasonReference: status === "REJECTED" ? "mock:reason" : null, status, transaction, escrowTransaction, isMock: true });
const jobFundingAuthorization = async (job: ReturnType<typeof mockJob>, transactionId = "transaction:job-fund") => {
  if (job.transaction === null) throw new Error("Job funding authorization requires transaction evidence.");
  const intentId = "intent:job-fund";
  const approvalId = "approval:job-fund";
  const bindingId = "binding:job-fund";
  const projectId = "project:job";
  const parameterCommitment = await hashJobParameterCommitment({ operationType: "JOB_FUND", jobId: job.jobId, asset: job.budget.asset, atomicAmount: job.budget.atomicUnits, deliverableReference: null, decision: null, reasonReference: null });
  const executionIntent = CanonicalExecutionIntentSchema.parse({
    version: 1, actionKind: "RELEASE_APPROVAL", projectId, releaseRequestId: job.jobId, transactionRecordId: transactionId, intentId,
    asset: job.budget.asset, atomicAmount: job.budget.atomicUnits, operationType: "JOB_FUND",
    protocolTarget: { kind: "ERC8183", standard: "ERC-8183", network: job.transaction.network, chainId: job.transaction.chainId, contractReference: job.contractAddress, jobId: job.jobId, method: "JOB_FUND", parameterCommitment, clientReference: job.clientAddress, providerReference: job.providerAddress, evaluatorReference: job.evaluatorAddress, destination: job.contractAddress },
  });
  const exactIntentHash = await hashCanonicalExecutionIntent(executionIntent);
  const jobApprovalDecision = ApprovalRecordSchema.parse({ id: approvalId, aggregateId: job.jobId, intentId, actionKind: "RELEASE_APPROVAL", authorizedActorType: "FOUNDER", authorizedActorId: job.clientAddress, exactIntentHash, idempotencyKey: "approval:job-fund:key", decision: "APPROVED", approver: { actorId: job.clientAddress, actorType: "FOUNDER" }, expiresAt: "2027-01-01T00:00:00.000Z", decidedAt: context.occurredAt });
  const executionBinding = ExecutionAuthorizationBindingSchema.parse({ id: bindingId, releaseRequestId: job.jobId, approvalId, intentId, exactIntentHash, transactionRecordId: transactionId, executionIntent, status: "CONSUMED", consumedAt: context.occurredAt, consumedByTransactionId: transactionId, createdAt: context.occurredAt });
  const idempotencyKey = "submission:job-fund:key";
  const submissionOperation = SubmissionOperationRecordSchema.parse({ id: "submission:job-fund", transactionId, idempotencyKey, arcTransaction: job.transaction, createdAt: context.occurredAt });
  return { authorizedApproverId: job.clientAddress, jobApprovalDecision, executionBinding, submissionOperation, idempotencyKey, expectedProjectId: projectId, expectedReleaseRequestId: job.jobId, expectedTransactionId: transactionId, expectedIntentId: intentId, expectedApprovalId: approvalId, expectedApprovalBindingId: bindingId, expectedExactIntentHash: exactIntentHash };
};
const providerSubmissionAuthorization = async (job: ReturnType<typeof mockJob>, transactionId = "transaction:job-submit") => {
  if (job.transaction === null) throw new Error("Provider submission authorization requires transaction evidence.");
  const intentId = "intent:job-submit";
  const approvalId = "approval:job-submit";
  const bindingId = "binding:job-submit";
  const projectId = "project:job";
  const parameterCommitment = await hashJobParameterCommitment({ operationType: "JOB_SUBMIT", jobId: job.jobId, asset: job.budget.asset, atomicAmount: job.budget.atomicUnits, deliverableReference: job.deliverableReference, decision: null, reasonReference: null });
  const executionIntent = CanonicalExecutionIntentSchema.parse({
    version: 1, actionKind: "JOB_SUBMISSION", projectId, releaseRequestId: job.jobId, transactionRecordId: transactionId, intentId,
    asset: job.budget.asset, atomicAmount: job.budget.atomicUnits, operationType: "JOB_SUBMIT",
    protocolTarget: { kind: "ERC8183", standard: "ERC-8183", network: job.transaction.network, chainId: job.transaction.chainId, contractReference: job.contractAddress, jobId: job.jobId, method: "JOB_SUBMIT", parameterCommitment, clientReference: job.clientAddress, providerReference: job.providerAddress, evaluatorReference: job.evaluatorAddress, destination: job.contractAddress },
  });
  const exactIntentHash = await hashCanonicalExecutionIntent(executionIntent);
  const jobApprovalDecision = ApprovalRecordSchema.parse({ id: approvalId, aggregateId: job.jobId, intentId, actionKind: "JOB_SUBMISSION", authorizedActorType: "PROVIDER", authorizedActorId: job.providerAddress, exactIntentHash, idempotencyKey: "approval:job-submit:key", decision: "APPROVED", approver: { actorId: job.providerAddress, actorType: "PROVIDER" }, expiresAt: "2027-01-01T00:00:00.000Z", decidedAt: context.occurredAt });
  const executionBinding = ExecutionAuthorizationBindingSchema.parse({ id: bindingId, releaseRequestId: job.jobId, approvalId, intentId, exactIntentHash, transactionRecordId: transactionId, executionIntent, status: "CONSUMED", consumedAt: context.occurredAt, consumedByTransactionId: transactionId, createdAt: context.occurredAt });
  const idempotencyKey = "submission:job-submit:key";
  const submissionOperation = SubmissionOperationRecordSchema.parse({ id: "submission:job-submit", transactionId, idempotencyKey, arcTransaction: job.transaction, createdAt: context.occurredAt });
  return { authorizedProviderId: job.providerAddress, jobApprovalDecision, executionBinding, submissionOperation, idempotencyKey, expectedProjectId: projectId, expectedReleaseRequestId: job.jobId, expectedTransactionId: transactionId, expectedIntentId: intentId, expectedApprovalId: approvalId, expectedApprovalBindingId: bindingId, expectedExactIntentHash: exactIntentHash };
};
const jobClientRejectionAuthorization = async (job: ReturnType<typeof mockJob>, transactionId = "transaction:job-reject:client") => {
  if (job.transaction === null) throw new Error("Client rejection authorization requires transaction evidence.");
  const intentId = "intent:job-reject:client";
  const approvalId = "approval:job-reject:client";
  const bindingId = "binding:job-reject:client";
  const projectId = "project:job";
  const parameterCommitment = await hashJobParameterCommitment({ operationType: "JOB_REJECT", jobId: job.jobId, asset: job.budget.asset, atomicAmount: job.budget.atomicUnits, deliverableReference: job.deliverableReference, decision: "REJECTED", reasonReference: job.reasonReference });
  const executionIntent = CanonicalExecutionIntentSchema.parse({
    version: 1, actionKind: "JOB_REJECTION", projectId, releaseRequestId: job.jobId, transactionRecordId: transactionId, intentId,
    asset: job.budget.asset, atomicAmount: job.budget.atomicUnits, operationType: "JOB_REJECT",
    protocolTarget: { kind: "ERC8183", standard: "ERC-8183", network: job.transaction.network, chainId: job.transaction.chainId, contractReference: job.contractAddress, jobId: job.jobId, method: "JOB_REJECT", parameterCommitment, clientReference: job.clientAddress, providerReference: job.providerAddress, evaluatorReference: job.evaluatorAddress, destination: job.contractAddress },
  });
  const exactIntentHash = await hashCanonicalExecutionIntent(executionIntent);
  const jobApprovalDecision = ApprovalRecordSchema.parse({ id: approvalId, aggregateId: job.jobId, intentId, actionKind: "JOB_REJECTION", authorizedActorType: "FOUNDER", authorizedActorId: job.clientAddress, exactIntentHash, idempotencyKey: "approval:job-reject:client:key", decision: "APPROVED", approver: { actorId: job.clientAddress, actorType: "FOUNDER" }, expiresAt: "2027-01-01T00:00:00.000Z", decidedAt: context.occurredAt });
  const executionBinding = ExecutionAuthorizationBindingSchema.parse({ id: bindingId, releaseRequestId: job.jobId, approvalId, intentId, exactIntentHash, transactionRecordId: transactionId, executionIntent, status: "CONSUMED", consumedAt: context.occurredAt, consumedByTransactionId: transactionId, createdAt: context.occurredAt });
  const idempotencyKey = "submission:job-reject:client:key";
  const submissionOperation = SubmissionOperationRecordSchema.parse({ id: "submission:job-reject:client", transactionId, idempotencyKey, arcTransaction: job.transaction, createdAt: context.occurredAt });
  return { authorizedApproverId: job.clientAddress, jobApprovalDecision, executionBinding, submissionOperation, idempotencyKey, expectedProjectId: projectId, expectedReleaseRequestId: job.jobId, expectedTransactionId: transactionId, expectedIntentId: intentId, expectedApprovalId: approvalId, expectedApprovalBindingId: bindingId, expectedExactIntentHash: exactIntentHash };
};
const jobEvaluationAuthorization = async (job: ReturnType<typeof mockJob>, decision: "APPROVED" | "REJECTED", transactionId = `transaction:job-evaluate:${decision.toLowerCase()}`) => {
  if (job.transaction === null) throw new Error("Job evaluation authorization requires transaction evidence.");
  const operationType = decision === "APPROVED" ? "JOB_EVALUATE" : "JOB_REJECT";
  const actionKind = decision === "APPROVED" ? "JOB_EVALUATION" : "JOB_REJECTION";
  const intentId = `intent:job-evaluate:${decision.toLowerCase()}`;
  const approvalId = `approval:${decision}`;
  const bindingId = `binding:job-evaluate:${decision.toLowerCase()}`;
  const projectId = "project:job";
  const parameterCommitment = await hashJobParameterCommitment({ operationType, jobId: job.jobId, asset: job.budget.asset, atomicAmount: job.budget.atomicUnits, deliverableReference: job.deliverableReference, decision, reasonReference: job.reasonReference });
  const executionIntent = CanonicalExecutionIntentSchema.parse({
    version: 1, actionKind, projectId, releaseRequestId: job.jobId, transactionRecordId: transactionId, intentId,
    asset: job.budget.asset, atomicAmount: job.budget.atomicUnits, operationType,
    protocolTarget: { kind: "ERC8183", standard: "ERC-8183", network: job.transaction.network, chainId: job.transaction.chainId, contractReference: job.contractAddress, jobId: job.jobId, method: operationType, parameterCommitment, clientReference: job.clientAddress, providerReference: job.providerAddress, evaluatorReference: job.evaluatorAddress, destination: job.contractAddress },
  });
  const exactIntentHash = await hashCanonicalExecutionIntent(executionIntent);
  const jobApprovalDecision = ApprovalRecordSchema.parse({ id: approvalId, aggregateId: job.jobId, intentId, actionKind, authorizedActorType: "EVALUATOR", authorizedActorId: job.evaluatorAddress, exactIntentHash, idempotencyKey: `approval:${decision}:key`, decision: "APPROVED", approver: { actorId: job.evaluatorAddress, actorType: "EVALUATOR" }, expiresAt: "2027-01-01T00:00:00.000Z", decidedAt: context.occurredAt });
  const executionBinding = ExecutionAuthorizationBindingSchema.parse({ id: bindingId, releaseRequestId: job.jobId, approvalId, intentId, exactIntentHash, transactionRecordId: transactionId, executionIntent, status: "CONSUMED", consumedAt: context.occurredAt, consumedByTransactionId: transactionId, createdAt: context.occurredAt });
  const idempotencyKey = `submission:job-evaluate:${decision.toLowerCase()}:key`;
  const submissionOperation = SubmissionOperationRecordSchema.parse({ id: `submission:job-evaluate:${decision.toLowerCase()}`, transactionId, idempotencyKey, arcTransaction: job.transaction, createdAt: context.occurredAt });
  const jobEvaluationEvidence = JobEvaluationEvidenceSchema.parse({ id: `evaluation:${decision}`, jobId: job.jobId, approvalId, intentId, exactIntentHash, decision, transactionHash: job.transaction.transactionHash, transactionNetwork: job.transaction.network, transactionChainId: job.transaction.chainId });
  return { authorizedEvaluatorId: job.evaluatorAddress, jobApprovalDecision, executionBinding, submissionOperation, idempotencyKey, jobEvaluationEvidence, expectedProjectId: projectId, expectedReleaseRequestId: job.jobId, expectedTransactionId: transactionId, expectedIntentId: intentId, expectedApprovalId: approvalId, expectedApprovalBindingId: bindingId, expectedExactIntentHash: exactIntentHash };
};
const jobRefundAuthorization = async (job: ReturnType<typeof mockJob>, transactionId = "transaction:job-refund") => {
  if (job.transaction === null) throw new Error("Job refund authorization requires transaction evidence.");
  const intentId = "intent:job-refund";
  const approvalId = "approval:job-refund";
  const bindingId = "binding:job-refund";
  const projectId = "project:job";
  const parameterCommitment = await hashJobParameterCommitment({ operationType: "REFUND", jobId: job.jobId, asset: job.budget.asset, atomicAmount: job.budget.atomicUnits, deliverableReference: job.deliverableReference, decision: null, reasonReference: null });
  const executionIntent = CanonicalExecutionIntentSchema.parse({
    version: 1, actionKind: "RELEASE_APPROVAL", projectId, releaseRequestId: job.jobId, transactionRecordId: transactionId, intentId,
    asset: job.budget.asset, atomicAmount: job.budget.atomicUnits, operationType: "REFUND",
    protocolTarget: { kind: "ERC8183", standard: "ERC-8183", network: job.transaction.network, chainId: job.transaction.chainId, contractReference: job.contractAddress, jobId: job.jobId, method: "CLAIM_REFUND", parameterCommitment, clientReference: job.clientAddress, providerReference: job.providerAddress, evaluatorReference: job.evaluatorAddress, destination: job.clientAddress },
  });
  const exactIntentHash = await hashCanonicalExecutionIntent(executionIntent);
  const jobApprovalDecision = ApprovalRecordSchema.parse({ id: approvalId, aggregateId: job.jobId, intentId, actionKind: "RELEASE_APPROVAL", authorizedActorType: "FOUNDER", authorizedActorId: job.clientAddress, exactIntentHash, idempotencyKey: "approval:job-refund:key", decision: "APPROVED", approver: { actorId: job.clientAddress, actorType: "FOUNDER" }, expiresAt: "2027-01-01T00:00:00.000Z", decidedAt: context.occurredAt });
  const executionBinding = ExecutionAuthorizationBindingSchema.parse({ id: bindingId, releaseRequestId: job.jobId, approvalId, intentId, exactIntentHash, transactionRecordId: transactionId, executionIntent, status: "CONSUMED", consumedAt: context.occurredAt, consumedByTransactionId: transactionId, createdAt: context.occurredAt });
  const idempotencyKey = "submission:job-refund:key";
  const jobRefundOperation = JobRefundOperationRecordSchema.parse({ id: "submission:job-refund", jobId: job.jobId, transactionId, idempotencyKey, arcTransaction: job.transaction, createdAt: job.expiresAt });
  return { authorizedApproverId: job.clientAddress, jobApprovalDecision, executionBinding, jobRefundOperation, idempotencyKey, expectedProjectId: projectId, expectedReleaseRequestId: job.jobId, expectedTransactionId: transactionId, expectedIntentId: intentId, expectedApprovalId: approvalId, expectedApprovalBindingId: bindingId, expectedExactIntentHash: exactIntentHash };
};
const liveHash = `0x${"a".repeat(64)}`;
const liveBlockHash = `0x${"b".repeat(64)}`;
const liveTransaction = { network: "ARC_TESTNET" as const, chainId: ARC_TESTNET_CHAIN_ID, transactionHash: liveHash, status: "CONFIRMED" as const, blockNumber: "1", blockHash: liveBlockHash, explorerUrl: arcTestnetExplorerTransactionUrl(liveHash), operationType: "SETTLEMENT" as const, isMock: false };

describe("atomic money", () => {
  it.each(["1.0", "01", "-1", "1e6", " 1", ""])("rejects non-canonical atomic units %j", (atomicUnits: string) => {
    expect(() => MoneyAmountSchema.parse({ asset: "USDC", atomicUnits })).toThrow();
  });
  it("uses exact bigint arithmetic without number inputs", async () => {
    expect(addMoney(money("USDC", "9007199254740993"), money("USDC", "7"))).toEqual(money("USDC", "9007199254741000"));
    expect(subtractMoney(money("USDC", "10"), money("USDC", "4"))).toEqual(money("USDC", "6"));
    expect(compareMoney(money("USDC", "4"), money("USDC", "5"))).toBe(-1);
  });
  it("rejects asset mismatch and underflow", async () => {
    expect(() => addMoney(money("USDC", "1"), money("EURC", "1"))).toThrow(MoneyError);
    expect(() => subtractMoney(money("USDC", "1"), money("USDC", "2"))).toThrow(MoneyError);
  });
  it("revalidates hydrated operands before arithmetic", async () => {
    const negative = { asset: "USDC", atomicUnits: "-1" } as ReturnType<typeof money>;
    expect(() => addMoney(negative, money("USDC", "1"))).toThrow();
    expect(() => subtractMoney(money("USDC", "1"), negative)).toThrow();
    expect(() => compareMoney(negative, money("USDC", "1"))).toThrow();
  });
});

describe("separate state machines", () => {
  it("exposes exactly the required ERC-8183 statuses", async () => {
    expect(AgenticJobStatusSchema.options).toEqual(["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"]);
  });
  it("enforces status-specific ERC-8183 evidence at the schema boundary", async () => {
    const open = mockJob("OPEN");
    const funded = mockJob("FUNDED", mockTransaction("CONFIRMED", "JOB_FUND"));
    const submitted = mockJob("SUBMITTED", mockTransaction("CONFIRMED", "JOB_SUBMIT"));
    const completed = mockJob("COMPLETED", mockTransaction("CONFIRMED", "JOB_EVALUATE"));
    const completedWithReason = AgenticJobRefSchema.parse({ ...completed, reasonReference: "mock:completion-attestation" });
    const rejected = mockJob("REJECTED", mockTransaction("CONFIRMED", "JOB_REJECT"));
    const fundedRejected = mockJob("REJECTED", mockTransaction("CONFIRMED", "JOB_REJECT"), funded.transaction);
    const submittedRejected = mockJob("REJECTED", mockTransaction("CONFIRMED", "JOB_REJECT"), submitted.transaction);
    const reasonlessRejected = AgenticJobRefSchema.parse({ ...rejected, reasonReference: null });
    const expiredFunded = AgenticJobRefSchema.parse({ ...funded, status: "EXPIRED", transaction: mockTransaction("CONFIRMED", "REFUND"), escrowTransaction: funded.transaction });
    const expiredSubmitted = AgenticJobRefSchema.parse({ ...submitted, status: "EXPIRED", transaction: mockTransaction("CONFIRMED", "REFUND"), escrowTransaction: submitted.transaction });
    for (const job of [open, funded, submitted, completed, completedWithReason, rejected, fundedRejected, submittedRejected, reasonlessRejected, expiredFunded, expiredSubmitted]) expect(AgenticJobRefSchema.parse(job)).toEqual(job);
    for (const invalid of [
      { ...open, status: "FUNDED" as const },
      { ...open, status: "EXPIRED" as const },
      { ...open, status: "COMPLETED" as const },
      { ...submitted, deliverableReference: null },
      { ...submitted, transaction: mockTransaction("SUBMITTED", "JOB_SUBMIT") },
      { ...completed, transaction: null },
      { ...funded, status: "EXPIRED" as const },
      { ...submitted, status: "EXPIRED" as const },
      { ...submitted, status: "EXPIRED" as const, reasonReference: "mock:forged-reason", transaction: mockTransaction("CONFIRMED", "REFUND") },
      { ...funded, status: "EXPIRED" as const, transaction: mockTransaction("CONFIRMED", "REFUND"), escrowTransaction: null },
      { ...rejected, escrowTransaction: mockTransaction("CONFIRMED", "JOB_SUBMIT") },
      { ...rejected, escrowTransaction: mockTransaction("SUBMITTED", "JOB_FUND") },
      { ...submitted, escrowTransaction: funded.transaction },
    ]) expect(AgenticJobRefSchema.safeParse(invalid).success).toBe(false);
  });
  it("emits an audit event for a successful application transition", async () => {
    expect(transitionApplication("NEEDS_REVIEW", "ELIGIBLE", { ...context, authorizedSystemId: "system" })).toMatchObject({ state: "ELIGIBLE", auditEvent: { eventType: "STATE_TRANSITIONED", details: { from: "NEEDS_REVIEW", to: "ELIGIBLE" } } });
  });
  it("does not mutate state or emit an event for an invalid transition", async () => {
    const record = Object.freeze({ state: "ELIGIBLE" as const });
    expect(() => transitionApplication(record.state, "CONFIRMED", context)).toThrow(InvalidTransitionError);
    expect(record).toEqual({ state: "ELIGIBLE" });
  });
  it("supports only explicit job transitions and never maps eligibility to completion", async () => {
    await expect(transitionAgenticJob("OPEN", "FUNDED", { ...context, actor: { actorId: "adapter", actorType: "ADAPTER" }, authorizedAdapterId: "adapter" })).rejects.toThrow();
    await expect(transitionAgenticJob("OPEN", "COMPLETED", context)).rejects.toThrow(InvalidTransitionError);
    expect(mapAgenticJobToApplication("OPEN")).toBeNull();
    expect(mapAgenticJobToApplication("COMPLETED")).toBeNull();
  });
  it.each(["FOUNDER", "EVALUATOR"] as const)("requires a persisted decision from the authorized %s", (actorType: "FOUNDER" | "EVALUATOR") => {
    const actor = { actorId: `authorized:${actorType}`, actorType }; const actionKind = actorType === "FOUNDER" ? "RELEASE_APPROVAL" : "MILESTONE_EVALUATION";
    const aggregateType = actorType === "FOUNDER" ? "release" : "milestone";
    const approvalDecision = ApprovalRecordSchema.parse({ id: "approval:decision", aggregateId: context.aggregateId, intentId: "intent:decision", actionKind, authorizedActorType: actorType, authorizedActorId: actor.actorId, exactIntentHash: `sha256:${"a".repeat(64)}`, idempotencyKey: "approval:key", decision: "APPROVED", approver: actor, expiresAt: "2027-01-01T00:00:00.000Z", decidedAt: context.occurredAt });
    const evidence = { ...context, aggregateType, actor, authorizedApproverId: actor.actorId, approvalDecision, expectedApprovalId: approvalDecision.id, expectedIntentId: approvalDecision.intentId, expectedExactIntentHash: approvalDecision.exactIntentHash };
    expect(transitionApplication("APPROVAL_PENDING", "APPROVED", evidence).state).toBe("APPROVED");
    expect(() => transitionApplication("APPROVAL_PENDING", "APPROVED", { ...evidence, aggregateType: aggregateType === "release" ? "milestone" : "release" })).toThrow(InvalidTransitionError);
    const rejected = ApprovalRecordSchema.parse({ ...approvalDecision, decision: "REJECTED" });
    expect(transitionApplication("APPROVAL_PENDING", "REJECTED", { ...evidence, approvalDecision: rejected }).state).toBe("REJECTED");
    expect(() => transitionApplication("APPROVAL_PENDING", "APPROVED", { ...evidence, approvalDecision: undefined })).toThrow();
    for (const changed of [{ aggregateId: "other" }, { intentId: "other" }, { exactIntentHash: `sha256:${"b".repeat(64)}` }, { decision: "REJECTED" as const }]) expect(() => transitionApplication("APPROVAL_PENDING", "APPROVED", { ...evidence, approvalDecision: { ...approvalDecision, ...changed } })).toThrow();
    expect(() => transitionApplication("APPROVAL_PENDING", "APPROVED", { ...evidence, approvalDecision: { ...approvalDecision, decidedAt: "2026-01-02T00:00:00.000Z" } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("APPROVAL_PENDING", "APPROVED", { ...evidence, occurredAt: approvalDecision.expiresAt })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("APPROVAL_PENDING", "APPROVED", { ...evidence, occurredAt: "not-a-time" })).toThrow(InvalidTransitionError);
  });
  it.each(["AI", "SYSTEM", "BACKER", "PROVIDER", "ADAPTER"] as const)("rejects %s approval without emitting a successful result", (actorType: "AI" | "SYSTEM" | "BACKER" | "PROVIDER" | "ADAPTER") => {
    expect(() => transitionApplication("APPROVAL_PENDING", "APPROVED", { ...context, actor: { actorId: "forbidden", actorType }, authorizedApproverId: "forbidden" })).toThrow(InvalidTransitionError);
  });
  it("rejects duplicate and out-of-order approval transitions after approval advances state", () => {
    const approvalDecision = ApprovalRecordSchema.parse({
      id: "approval:state-machine",
      aggregateId: context.aggregateId,
      intentId: "intent:state-machine",
      actionKind: "RELEASE_APPROVAL",
      authorizedActorType: "FOUNDER",
      authorizedActorId: "founder:state-machine",
      exactIntentHash: `sha256:${"a".repeat(64)}`,
      idempotencyKey: "approval:state-machine:key",
      decision: "APPROVED",
      approver: { actorId: "founder:state-machine", actorType: "FOUNDER" },
      expiresAt: "2027-01-01T00:00:00.000Z",
      decidedAt: context.occurredAt,
    });
    const approvalContext = {
      ...context,
      aggregateType: "release",
      actor: { actorId: "founder:state-machine", actorType: "FOUNDER" as const },
      authorizedApproverId: "founder:state-machine",
      approvalDecision,
      expectedApprovalId: approvalDecision.id,
      expectedIntentId: approvalDecision.intentId,
      expectedExactIntentHash: approvalDecision.exactIntentHash,
    };
    const approved = transitionApplication("APPROVAL_PENDING", "APPROVED", approvalContext);
    expect(approved.state).toBe("APPROVED");
    expect(() => transitionApplication(approved.state, "APPROVED", { ...approvalContext, eventId: "event:duplicate-approval" })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("ELIGIBLE", "APPROVED", { ...approvalContext, eventId: "event:out-of-order-approval" })).toThrow(InvalidTransitionError);
  });
  it("requires persisted approval and exact canonical intent evidence to submit", async () => {
    const transaction = TransactionRecordSchema.parse({ id: "transaction:submission", projectId: "project:1", releaseRequestId: "release:1", intentId: "intent:1", destinationReference: "mock:recipient", approvalId: "approval:1", approvalBindingId: "binding:submission", reconciliationId: null, idempotencyKey: "transaction:key", amount: usdc("1"), operationState: "SUBMITTED", arcTransaction: mockTransaction("SUBMITTED"), createdAt: context.occurredAt, updatedAt: context.occurredAt });
    const executionIntent = CanonicalExecutionIntentSchema.parse({ version: 1, actionKind: "RELEASE_APPROVAL", projectId: transaction.projectId, releaseRequestId: transaction.releaseRequestId, transactionRecordId: transaction.id, intentId: transaction.intentId, asset: "USDC", atomicAmount: "1", operationType: "SETTLEMENT", protocolTarget: { kind: "DESTINATION", destination: transaction.destinationReference, network: "ARC_TESTNET", chainId: "synthetic:chain", isMock: true } });
    for (const protocolTarget of [
      { ...executionIntent.protocolTarget, network: null },
      { ...executionIntent.protocolTarget, chainId: null },
      { ...executionIntent.protocolTarget, network: "OTHER_NETWORK" },
      { ...executionIntent.protocolTarget, destination: "not-an-address" },
    ]) expect(CanonicalExecutionIntentSchema.safeParse({ ...executionIntent, protocolTarget }).success).toBe(false);
    const liveDestinationTarget = { kind: "DESTINATION" as const, destination: `0x${"1".repeat(40)}`, network: "ARC_TESTNET" as const, chainId: ARC_TESTNET_CHAIN_ID, isMock: false };
    expect(CanonicalExecutionIntentSchema.safeParse({ ...executionIntent, protocolTarget: liveDestinationTarget }).success).toBe(true);
    expect(CanonicalExecutionIntentSchema.safeParse({ ...executionIntent, protocolTarget: { ...liveDestinationTarget, destination: "mock:recipient" } }).success).toBe(false);
    expect(CanonicalExecutionIntentSchema.safeParse({ ...executionIntent, protocolTarget: { ...executionIntent.protocolTarget, destination: liveDestinationTarget.destination } }).success).toBe(false);
    const exactIntentHash = await hashCanonicalExecutionIntent(executionIntent);
    const approvalDecision = ApprovalRecordSchema.parse({ id: transaction.approvalId, aggregateId: transaction.releaseRequestId, intentId: transaction.intentId, actionKind: "RELEASE_APPROVAL", authorizedActorType: "FOUNDER", authorizedActorId: "founder:1", exactIntentHash, idempotencyKey: "approval:key", decision: "APPROVED", approver: { actorId: "founder:1", actorType: "FOUNDER" }, expiresAt: "2027-01-01T00:00:00.000Z", decidedAt: context.occurredAt });
    const binding = ExecutionAuthorizationBindingSchema.parse({ id: transaction.approvalBindingId, releaseRequestId: transaction.releaseRequestId, approvalId: transaction.approvalId, intentId: transaction.intentId, exactIntentHash, transactionRecordId: transaction.id, executionIntent, status: "CONSUMED", consumedAt: context.occurredAt, consumedByTransactionId: transaction.id, createdAt: context.occurredAt });
    const currentReleaseRequest = ReleaseRequestSchema.parse({ id: transaction.releaseRequestId, projectId: transaction.projectId, milestoneId: "milestone:1", proofId: "proof:1", intentId: transaction.intentId, settlementId: null, amount: transaction.amount, state: "PREPARED", approvalId: transaction.approvalId, idempotencyKey: "release:key", createdAt: context.occurredAt });
    const submissionOperation = SubmissionOperationRecordSchema.parse({ id: "submission:1", transactionId: transaction.id, idempotencyKey: "submission:key", arcTransaction: transaction.arcTransaction!, createdAt: context.occurredAt });
    const submitted = { ...context, aggregateId: transaction.releaseRequestId, actor: { actorId: "adapter:authorized", actorType: "ADAPTER" as const }, authorizedAdapterId: "adapter:authorized", authorizedApproverId: approvalDecision.authorizedActorId, idempotencyKey: submissionOperation.idempotencyKey, currentReleaseRequest, submissionTransaction: transaction, executionBinding: binding, approvalDecision, submissionOperation, expectedTransactionId: transaction.id, expectedProjectId: transaction.projectId, expectedReleaseRequestId: transaction.releaseRequestId, expectedIntentId: transaction.intentId, expectedApprovalId: transaction.approvalId!, expectedApprovalBindingId: transaction.approvalBindingId!, expectedExactIntentHash: exactIntentHash };
    await expect(transitionApplicationSubmission({ ...submitted, submissionTransaction: undefined })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, currentReleaseRequest: undefined })).rejects.toThrow(InvalidTransitionError);
    for (const state of ["APPROVED", "SUBMITTED", "FAILED", "REJECTED"] as const) await expect(transitionApplicationSubmission({ ...submitted, currentReleaseRequest: { ...currentReleaseRequest, state } })).rejects.toThrow(InvalidTransitionError);
    for (const changed of [{ id: "release:other" }, { projectId: "project:other" }, { intentId: "intent:other" }, { approvalId: "approval:other" }, { amount: usdc("2") }]) await expect(transitionApplicationSubmission({ ...submitted, currentReleaseRequest: { ...currentReleaseRequest, ...changed } })).rejects.toThrow(InvalidTransitionError);
    expect(() => transitionApplication("PREPARED", "SUBMITTED", submitted)).toThrow(InvalidTransitionError);
    for (const status of ["PREPARED", "CONFIRMED", "FAILED"] as const) await expect(transitionApplicationSubmission({ ...submitted, submissionTransaction: { ...transaction, operationState: status, arcTransaction: mockTransaction(status) } })).rejects.toThrow(InvalidTransitionError);
    for (const status of ["ACTIVE", "REVOKED"] as const) await expect(transitionApplicationSubmission({ ...submitted, executionBinding: { ...binding, status, consumedAt: null, consumedByTransactionId: null } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, executionBinding: { ...binding, consumedByTransactionId: "transaction:other" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, submissionOperation: undefined })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, submissionOperation: { ...submissionOperation, arcTransaction: { ...submissionOperation.arcTransaction, transactionHash: "mock:unrelated-release" } } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, submissionOperation: { ...submissionOperation, arcTransaction: { ...submissionOperation.arcTransaction, status: "FAILED" } } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, submissionOperation: { ...submissionOperation, createdAt: "2025-12-31T23:59:59.000Z" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, submissionOperation: { ...submissionOperation, createdAt: "2026-01-02T00:00:00.000Z" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, idempotencyKey: "submission:other" })).rejects.toThrow(InvalidTransitionError);
    for (const changed of [{ projectId: "project:other" }, { releaseRequestId: "release:other" }, { intentId: "intent:other" }, { approvalId: "approval:other" }, { approvalBindingId: "binding:other" }]) await expect(transitionApplicationSubmission({ ...submitted, submissionTransaction: { ...transaction, ...changed } })).rejects.toThrow(InvalidTransitionError);
    for (const changed of [{ amount: usdc("2") }, { destinationReference: "mock:other" }, { arcTransaction: { ...transaction.arcTransaction!, operationType: "REFUND" as const } }, { arcTransaction: { ...transaction.arcTransaction!, chainId: "synthetic:other-chain" } }]) await expect(transitionApplicationSubmission({ ...submitted, submissionTransaction: { ...transaction, ...changed } })).rejects.toThrow(InvalidTransitionError);
    expect(() => TransactionRecordSchema.parse({ ...transaction, amount: money("EURC", "1") })).toThrow();
    await expect(transitionApplicationSubmission({ ...submitted, submissionTransaction: { ...transaction, arcTransaction: { ...transaction.arcTransaction!, network: "OTHER_NETWORK" } } as unknown as typeof transaction })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, approvalDecision: { ...approvalDecision, decision: "REJECTED" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, authorizedApproverId: undefined })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, authorizedApproverId: "founder:other" })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, approvalDecision: { ...approvalDecision, authorizedActorId: "founder:other", approver: { actorId: "founder:other", actorType: "FOUNDER" } } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, approvalDecision: { ...approvalDecision, exactIntentHash: `sha256:${"b".repeat(64)}` } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, executionBinding: { ...binding, exactIntentHash: `sha256:${"b".repeat(64)}` } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, expectedExactIntentHash: undefined })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, expectedExactIntentHash: `sha256:${"b".repeat(64)}` })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, executionBinding: { ...binding, consumedAt: "2026-01-02T00:00:00.000Z" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, occurredAt: "2026-01-03T00:00:00.000Z", approvalDecision: { ...approvalDecision, decidedAt: "2026-01-02T00:00:00.000Z" }, executionBinding: { ...binding, consumedAt: "2026-01-01T00:00:00.000Z" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission(submitted)).resolves.toMatchObject({ state: "SUBMITTED" });
    type SubmissionOperationType = NonNullable<typeof transaction.arcTransaction>["operationType"];
    const erc8183Target = (method: "JOB_FUND" | "JOB_SUBMIT" | "JOB_EVALUATE" | "JOB_REJECT") => ({ kind: "ERC8183" as const, standard: "ERC-8183" as const, network: "ARC_TESTNET" as const, chainId: "synthetic:chain", contractReference: "mock:contract", jobId: "mock:job", method, parameterCommitment: `sha256:${"c".repeat(64)}`, clientReference: "mock:client", providerReference: "mock:provider", evaluatorReference: "mock:evaluator", destination: transaction.destinationReference });
    const submissionForOperation = async (operationType: SubmissionOperationType, actorType: "FOUNDER" | "PROVIDER" | "EVALUATOR") => {
      const actionKind = operationType === "JOB_REJECT" ? "JOB_REJECTION" : actorType === "FOUNDER" ? "RELEASE_APPROVAL" : actorType === "PROVIDER" ? "JOB_SUBMISSION" : "JOB_EVALUATION";
      const protocolTarget = operationType === "JOB_FUND" || operationType === "JOB_SUBMIT" || operationType === "JOB_EVALUATE" || operationType === "JOB_REJECT" ? erc8183Target(operationType) : { kind: "DESTINATION" as const, destination: transaction.destinationReference, network: "ARC_TESTNET" as const, chainId: "synthetic:chain", isMock: true };
      const candidateTransaction = TransactionRecordSchema.parse({ ...transaction, arcTransaction: { ...transaction.arcTransaction!, operationType } });
      const candidateIntent = CanonicalExecutionIntentSchema.parse({ ...executionIntent, actionKind, operationType, protocolTarget });
      const candidateHash = await hashCanonicalExecutionIntent(candidateIntent);
      const actorId = actorType === "FOUNDER" ? "founder:1" : actorType === "PROVIDER" ? "mock:provider" : "mock:evaluator";
      const approvalAggregateId = protocolTarget.kind === "ERC8183" ? protocolTarget.jobId : transaction.releaseRequestId;
      const candidateApproval = ApprovalRecordSchema.parse({ ...approvalDecision, aggregateId: approvalAggregateId, actionKind, authorizedActorType: actorType, authorizedActorId: actorId, approver: { actorId, actorType }, exactIntentHash: candidateHash });
      const candidateBinding = ExecutionAuthorizationBindingSchema.parse({ ...binding, exactIntentHash: candidateHash, executionIntent: candidateIntent });
      return { ...submitted, submissionTransaction: candidateTransaction, submissionOperation: { ...submissionOperation, arcTransaction: candidateTransaction.arcTransaction! }, executionBinding: candidateBinding, approvalDecision: candidateApproval, authorizedApproverId: actorType === "FOUNDER" ? actorId : undefined, authorizedEvaluatorId: actorType === "EVALUATOR" ? actorId : undefined, expectedExactIntentHash: candidateHash };
    };
    const submitForOperation = async (operationType: SubmissionOperationType, actorType: "FOUNDER" | "PROVIDER" | "EVALUATOR") => transitionApplicationSubmission(await submissionForOperation(operationType, actorType));
    await expect(submitForOperation("SETTLEMENT", "FOUNDER")).resolves.toMatchObject({ state: "SUBMITTED" });
    await expect(submitForOperation("REFUND", "FOUNDER")).resolves.toMatchObject({ state: "SUBMITTED" });
    await expect(submitForOperation("JOB_FUND", "FOUNDER")).rejects.toThrow(InvalidTransitionError);
    await expect(submitForOperation("JOB_SUBMIT", "PROVIDER")).rejects.toThrow(InvalidTransitionError);
    await expect(submitForOperation("JOB_EVALUATE", "EVALUATOR")).resolves.toMatchObject({ state: "SUBMITTED" });
    await expect(submitForOperation("JOB_REJECT", "EVALUATOR")).resolves.toMatchObject({ state: "SUBMITTED" });
    const terminalJobSubmission = await submissionForOperation("JOB_EVALUATE", "EVALUATOR");
    await expect(transitionApplicationSubmission({ ...terminalJobSubmission, authorizedEvaluatorId: undefined })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...terminalJobSubmission, authorizedEvaluatorId: "mock:other-evaluator" })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...terminalJobSubmission, approvalDecision: { ...terminalJobSubmission.approvalDecision!, aggregateId: transaction.releaseRequestId } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, approvalDecision: { ...approvalDecision, actionKind: "JOB_EVALUATION", authorizedActorType: "EVALUATOR", authorizedActorId: "evaluator:1", approver: { actorId: "evaluator:1", actorType: "EVALUATOR" as const } } })).rejects.toThrow(InvalidTransitionError);
    const jobFundIntent = CanonicalExecutionIntentSchema.parse({ ...executionIntent, operationType: "JOB_FUND", protocolTarget: erc8183Target("JOB_FUND") });
    const jobEvaluateIntent = CanonicalExecutionIntentSchema.parse({ ...executionIntent, actionKind: "JOB_EVALUATION", operationType: "JOB_EVALUATE", protocolTarget: erc8183Target("JOB_EVALUATE") });
    expect(CanonicalExecutionIntentSchema.safeParse({ ...jobFundIntent, actionKind: "JOB_EVALUATION" }).success).toBe(false);
    expect(CanonicalExecutionIntentSchema.safeParse({ ...jobEvaluateIntent, actionKind: "RELEASE_APPROVAL" }).success).toBe(false);
    const wrongJobFundIntent = { ...jobFundIntent, actionKind: "JOB_EVALUATION" as const };
    const wrongJobEvaluateIntent = { ...jobEvaluateIntent, actionKind: "RELEASE_APPROVAL" as const };
    const jobFundTransaction = TransactionRecordSchema.parse({ ...transaction, arcTransaction: { ...transaction.arcTransaction!, operationType: "JOB_FUND" as const } });
    const jobEvaluateTransaction = TransactionRecordSchema.parse({ ...transaction, arcTransaction: { ...transaction.arcTransaction!, operationType: "JOB_EVALUATE" as const } });
    await expect(transitionApplicationSubmission({ ...submitted, submissionTransaction: jobFundTransaction, executionBinding: { ...binding, executionIntent: wrongJobFundIntent } as unknown as typeof binding })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, submissionTransaction: jobEvaluateTransaction, executionBinding: { ...binding, executionIntent: wrongJobEvaluateIntent } as unknown as typeof binding })).rejects.toThrow(InvalidTransitionError);
    expect(CanonicalExecutionIntentSchema.safeParse({ ...jobFundIntent, protocolTarget: erc8183Target("JOB_EVALUATE") }).success).toBe(false);
    expect(CanonicalExecutionIntentSchema.safeParse({ ...jobEvaluateIntent, protocolTarget: erc8183Target("JOB_FUND") }).success).toBe(false);
    expect(await hashCanonicalExecutionIntent({ ...jobFundIntent, actionKind: "JOB_EVALUATION" } as unknown as typeof jobFundIntent)).not.toBe(await hashCanonicalExecutionIntent(jobFundIntent));
    expect(await hashCanonicalExecutionIntent({ ...jobFundIntent, protocolTarget: erc8183Target("JOB_EVALUATE") } as unknown as typeof jobFundIntent)).not.toBe(await hashCanonicalExecutionIntent(jobFundIntent));
    for (const operationType of ["JOB_CREATE", "IDENTITY_REGISTRATION", "REPUTATION_WRITE"] as const) {
      const protocolTarget = { kind: "DESTINATION" as const, destination: transaction.destinationReference, network: "ARC_TESTNET" as const, chainId: "synthetic:chain", isMock: true };
      for (const actionKind of ["RELEASE_APPROVAL", "JOB_SUBMISSION", "JOB_EVALUATION"] as const) expect(CanonicalExecutionIntentSchema.safeParse({ ...executionIntent, actionKind, operationType, protocolTarget }).success).toBe(false);
      const rawUnsupportedIntent = { ...executionIntent, actionKind: "RELEASE_APPROVAL" as const, operationType, protocolTarget };
      const unsupportedTransaction = TransactionRecordSchema.parse({ ...transaction, arcTransaction: { ...transaction.arcTransaction!, operationType } });
      await expect(transitionApplicationSubmission({ ...submitted, submissionTransaction: unsupportedTransaction, executionBinding: { ...binding, executionIntent: rawUnsupportedIntent } as unknown as typeof binding })).rejects.toThrow(InvalidTransitionError);
    }
    for (const actorType of ["AI", "FOUNDER", "PROVIDER", "EVALUATOR"] as const) await expect(transitionApplicationSubmission({ ...submitted, actor: { actorId: "adapter:authorized", actorType } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, actor: { actorId: "adapter:other", actorType: "ADAPTER" } })).rejects.toThrow(InvalidTransitionError);
  });
  it("requires exact transaction evidence for preparation and failure", async () => {
    const makeTransaction = (status: "PREPARED" | "FAILED") => TransactionRecordSchema.parse({ id: `transaction:${status}`, projectId: "project:1", releaseRequestId: "release:1", intentId: "intent:1", destinationReference: "mock:recipient", approvalId: "approval:1", approvalBindingId: "binding:1", reconciliationId: null, idempotencyKey: `transaction:${status}:key`, amount: usdc("1"), operationState: status, arcTransaction: mockTransaction(status), createdAt: context.occurredAt, updatedAt: context.occurredAt });
    const adapter = { actorId: "adapter", actorType: "ADAPTER" as const };
    const evidence = (transaction: ReturnType<typeof makeTransaction>) => ({ ...context, aggregateId: transaction.releaseRequestId, actor: adapter, authorizedAdapterId: adapter.actorId, lifecycleTransaction: transaction, expectedTransactionId: transaction.id, expectedProjectId: transaction.projectId, expectedReleaseRequestId: transaction.releaseRequestId, expectedIntentId: transaction.intentId, expectedApprovalId: transaction.approvalId!, expectedApprovalBindingId: transaction.approvalBindingId!, expectedOperationType: transaction.arcTransaction!.operationType });
    const prepared = makeTransaction("PREPARED"); expect(transitionApplication("APPROVED", "PREPARED", evidence(prepared)).state).toBe("PREPARED");
    expect(() => transitionApplication("APPROVED", "PREPARED", { ...evidence(prepared), lifecycleTransaction: undefined })).toThrow();
    expect(() => transitionApplication("APPROVED", "PREPARED", { ...evidence(prepared), expectedOperationType: undefined })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("APPROVED", "PREPARED", { ...evidence(prepared), expectedOperationType: "REFUND" })).toThrow(InvalidTransitionError);
    for (const operationType of ["JOB_CREATE", "JOB_FUND", "JOB_SUBMIT", "IDENTITY_REGISTRATION", "REPUTATION_WRITE"] as const) {
      const unrelated = TransactionRecordSchema.parse({ ...prepared, arcTransaction: { ...mockTransaction("PREPARED"), operationType } });
      expect(() => transitionApplication("APPROVED", "PREPARED", evidence(unrelated))).toThrow(InvalidTransitionError);
    }
    const refundPrepared = TransactionRecordSchema.parse({ ...prepared, arcTransaction: mockTransaction("PREPARED", "REFUND") });
    expect(transitionApplication("APPROVED", "PREPARED", evidence(refundPrepared)).state).toBe("PREPARED");
    for (const operationType of ["JOB_EVALUATE", "JOB_REJECT"] as const) {
      const terminalPrepared = TransactionRecordSchema.parse({ ...prepared, arcTransaction: { ...mockTransaction("PREPARED"), operationType } });
      expect(transitionApplication("APPROVED", "PREPARED", evidence(terminalPrepared)).state).toBe("PREPARED");
      expect(() => transitionApplication("APPROVED", "PREPARED", { ...evidence(terminalPrepared), expectedOperationType: operationType === "JOB_EVALUATE" ? "JOB_REJECT" : "JOB_EVALUATE" })).toThrow(InvalidTransitionError);
      expect(() => transitionApplication("PREPARED", "FAILED", evidence(TransactionRecordSchema.parse({ ...terminalPrepared, operationState: "FAILED", arcTransaction: { ...mockTransaction("FAILED"), operationType } })))).toThrow(InvalidTransitionError);
    }
    const failed = makeTransaction("FAILED");
    expect(transitionApplication("PREPARED", "FAILED", evidence(failed)).state).toBe("FAILED");
    const failedSubmission = TransactionRecordSchema.parse({ ...failed, arcTransaction: { ...mockTransaction("FAILED"), transactionHash: "mock:transaction" } });
    const priorSubmittedTransaction = TransactionRecordSchema.parse({ ...failedSubmission, operationState: "SUBMITTED", arcTransaction: mockTransaction("SUBMITTED") });
    const priorSubmissionOperation = SubmissionOperationRecordSchema.parse({ id: "submission:failed", transactionId: priorSubmittedTransaction.id, idempotencyKey: "submission:failed:key", arcTransaction: priorSubmittedTransaction.arcTransaction!, createdAt: context.occurredAt });
    const failedSubmissionEvidence = { ...evidence(failedSubmission), submissionTransaction: priorSubmittedTransaction, submissionOperation: priorSubmissionOperation, idempotencyKey: priorSubmissionOperation.idempotencyKey };
    expect(transitionApplication("SUBMITTED", "FAILED", failedSubmissionEvidence).state).toBe("FAILED");
    for (const operationType of ["JOB_EVALUATE", "JOB_REJECT"] as const) {
      const failedJobTransaction = TransactionRecordSchema.parse({ ...failedSubmission, arcTransaction: { ...failedSubmission.arcTransaction!, operationType } });
      const submittedJobTransaction = TransactionRecordSchema.parse({ ...priorSubmittedTransaction, arcTransaction: { ...priorSubmittedTransaction.arcTransaction!, operationType } });
      const submittedJobOperation = SubmissionOperationRecordSchema.parse({ ...priorSubmissionOperation, arcTransaction: submittedJobTransaction.arcTransaction! });
      const failedJobEvidence = { ...failedSubmissionEvidence, lifecycleTransaction: failedJobTransaction, submissionTransaction: submittedJobTransaction, submissionOperation: submittedJobOperation, expectedOperationType: operationType };
      expect(transitionApplication("SUBMITTED", "FAILED", failedJobEvidence).state).toBe("FAILED");
      expect(() => transitionApplication("PREPARED", "FAILED", evidence(failedJobTransaction))).toThrow(InvalidTransitionError);
    }
    expect(() => transitionApplication("SUBMITTED", "FAILED", { ...failedSubmissionEvidence, submissionTransaction: undefined })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "FAILED", { ...failedSubmissionEvidence, submissionOperation: undefined })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "FAILED", { ...failedSubmissionEvidence, idempotencyKey: "submission:other:key" })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "FAILED", { ...failedSubmissionEvidence, lifecycleTransaction: { ...failedSubmission, idempotencyKey: "transaction:other:key" } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "FAILED", { ...failedSubmissionEvidence, lifecycleTransaction: { ...failedSubmission, arcTransaction: { ...failedSubmission.arcTransaction!, transactionHash: "mock:other-failure" } } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "FAILED", { ...failedSubmissionEvidence, submissionTransaction: { ...priorSubmittedTransaction, arcTransaction: { ...priorSubmittedTransaction.arcTransaction!, transactionHash: "mock:other-submission" } } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "FAILED", { ...failedSubmissionEvidence, submissionOperation: { ...priorSubmissionOperation, arcTransaction: { ...priorSubmissionOperation.arcTransaction, operationType: "REFUND" } } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("PREPARED", "FAILED", { ...context, actor: adapter, authorizedAdapterId: adapter.actorId })).toThrow();
    expect(() => transitionApplication("PREPARED", "FAILED", { ...evidence(failed), lifecycleTransaction: prepared })).toThrow();
  });
  it("requires exact confirmed transaction evidence before application confirmation", async () => {
    const transaction = TransactionRecordSchema.parse({ id: "transaction:confirmation", projectId: "project:1", releaseRequestId: "release:1", intentId: "intent:1", destinationReference: "mock:recipient", approvalId: "approval:1", approvalBindingId: "binding:1", reconciliationId: null, idempotencyKey: "transaction:confirmation:key", amount: usdc("1"), operationState: "CONFIRMED", arcTransaction: mockTransaction("CONFIRMED"), createdAt: context.occurredAt, updatedAt: context.occurredAt });
    const submittedRelease = ReleaseRequestSchema.parse({ id: transaction.releaseRequestId, projectId: transaction.projectId, milestoneId: "milestone:1", proofId: "proof:1", intentId: transaction.intentId, settlementId: null, amount: transaction.amount, state: "SUBMITTED", approvalId: transaction.approvalId, idempotencyKey: "release:confirmation:key", createdAt: context.occurredAt });
    const submittedTransaction = TransactionRecordSchema.parse({ ...transaction, operationState: "SUBMITTED", arcTransaction: mockTransaction("SUBMITTED") });
    const confirmation = { ...context, aggregateId: transaction.releaseRequestId, actor: { actorId: "adapter:authorized", actorType: "ADAPTER" as const }, authorizedAdapterId: "adapter:authorized", currentReleaseRequest: submittedRelease, submissionTransaction: submittedTransaction, confirmationTransaction: transaction, expectedTransactionId: transaction.id, expectedProjectId: transaction.projectId, expectedReleaseRequestId: transaction.releaseRequestId, expectedIntentId: transaction.intentId, expectedApprovalId: transaction.approvalId!, expectedApprovalBindingId: transaction.approvalBindingId!, expectedOperationType: transaction.arcTransaction!.operationType };
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: undefined })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, currentReleaseRequest: undefined })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, submissionTransaction: undefined })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: { ...transaction, amount: usdc("2") } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: { ...transaction, destinationReference: "mock:other" } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: { ...transaction, idempotencyKey: "transaction:confirmation:other-key" } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: { ...transaction, arcTransaction: { ...transaction.arcTransaction!, transactionHash: "mock:different" } } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: { ...transaction, arcTransaction: { ...transaction.arcTransaction!, chainId: "synthetic:other-chain" } } })).toThrow(InvalidTransitionError);
    for (const status of ["PREPARED", "SUBMITTED", "FAILED"] as const) expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: { ...transaction, operationState: status, arcTransaction: mockTransaction(status) } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: { ...transaction, releaseRequestId: "release:other" } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: { ...transaction, id: "transaction:other" } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, aggregateId: "release:other" })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, expectedIntentId: undefined })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, expectedApprovalId: undefined })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, expectedApprovalBindingId: undefined })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: { ...transaction, intentId: "intent:other" } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: { ...transaction, approvalId: "approval:other" } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: { ...transaction, approvalBindingId: "binding:other" } })).toThrow(InvalidTransitionError);
    for (const operationType of ["JOB_FUND", "JOB_SUBMIT"] as const) {
      const otherOperation = TransactionRecordSchema.parse({ ...transaction, arcTransaction: mockTransaction("CONFIRMED", operationType) });
      expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: otherOperation, expectedOperationType: operationType })).toThrow(InvalidTransitionError);
    }
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, expectedOperationType: "REFUND" })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, expectedOperationType: undefined })).toThrow(InvalidTransitionError);
    expect(transitionApplication("SUBMITTED", "CONFIRMED", confirmation).state).toBe("CONFIRMED");
    const refundTransaction = TransactionRecordSchema.parse({ ...transaction, arcTransaction: mockTransaction("CONFIRMED", "REFUND") });
    const submittedRefundTransaction = TransactionRecordSchema.parse({ ...submittedTransaction, arcTransaction: mockTransaction("SUBMITTED", "REFUND") });
    expect(transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, submissionTransaction: submittedRefundTransaction, confirmationTransaction: refundTransaction, expectedOperationType: "REFUND" }).state).toBe("CONFIRMED");
    const completionTransaction = TransactionRecordSchema.parse({ ...transaction, arcTransaction: mockTransaction("CONFIRMED", "JOB_EVALUATE") });
    const submittedCompletionTransaction = TransactionRecordSchema.parse({ ...submittedTransaction, arcTransaction: mockTransaction("SUBMITTED", "JOB_EVALUATE") });
    expect(transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, submissionTransaction: submittedCompletionTransaction, confirmationTransaction: completionTransaction, expectedOperationType: "JOB_EVALUATE" }).state).toBe("CONFIRMED");
    const rejectionTransaction = TransactionRecordSchema.parse({ ...transaction, arcTransaction: mockTransaction("CONFIRMED", "JOB_REJECT") });
    const submittedRejectionTransaction = TransactionRecordSchema.parse({ ...submittedTransaction, arcTransaction: mockTransaction("SUBMITTED", "JOB_REJECT") });
    expect(transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, submissionTransaction: submittedRejectionTransaction, confirmationTransaction: rejectionTransaction, expectedOperationType: "JOB_REJECT" }).state).toBe("CONFIRMED");
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: refundTransaction, expectedOperationType: "SETTLEMENT" })).toThrow(InvalidTransitionError);
    for (const actorType of ["AI", "FOUNDER", "EVALUATOR"] as const) expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, actor: { actorId: "adapter:authorized", actorType } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, actor: { actorId: "adapter:other", actorType: "ADAPTER" } })).toThrow(InvalidTransitionError);
  });
  it("requires exact MATCHED evidence before application reconciliation", async () => {
    const reconciliationId = "reconciliation:transition";
    const transaction = TransactionRecordSchema.parse({ id: "transaction:reconciled", projectId: "project:1", releaseRequestId: "release:1", intentId: "intent:1", destinationReference: "mock:recipient", approvalId: "approval:1", approvalBindingId: "binding:1", reconciliationId, idempotencyKey: "transaction:key", amount: usdc("1"), operationState: "RECONCILED", arcTransaction: mockTransaction("CONFIRMED"), createdAt: context.occurredAt, updatedAt: context.occurredAt });
    const settlement = SettlementRecordSchema.parse({ id: "settlement:reconciled", projectId: transaction.projectId, releaseRequestId: transaction.releaseRequestId, reconciliationId, idempotencyKey: "settlement:key", amount: transaction.amount, state: "RECONCILED", job: null, transaction: transaction.arcTransaction, updatedAt: context.occurredAt });
    const reconciliation = ReconciliationRecordSchema.parse({ id: reconciliationId, projectId: transaction.projectId, transactionRecordId: transaction.id, settlementId: settlement.id, result: "MATCHED", evidenceReference: "mock:reconciliation-evidence", reconciledAt: context.occurredAt, actor: { actorId: "adapter:authorized", actorType: "ADAPTER" } });
    const reconciled = { ...context, aggregateId: transaction.releaseRequestId, actor: { actorId: "adapter:authorized", actorType: "ADAPTER" as const }, authorizedAdapterId: "adapter:authorized", reconciliationTransaction: transaction, reconciliationSettlement: settlement, reconciliationRecord: reconciliation };
    expect(() => transitionApplication("CONFIRMED", "RECONCILED", { ...reconciled, reconciliationRecord: undefined })).toThrow(InvalidTransitionError);
    for (const result of ["MISMATCH", "REQUIRES_REVIEW"] as const) expect(() => transitionApplication("CONFIRMED", "RECONCILED", { ...reconciled, reconciliationRecord: { ...reconciliation, result } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("CONFIRMED", "RECONCILED", { ...reconciled, reconciliationRecord: { ...reconciliation, evidenceReference: "" } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("CONFIRMED", "RECONCILED", { ...reconciled, reconciliationTransaction: { ...transaction, id: "transaction:other" } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("CONFIRMED", "RECONCILED", { ...reconciled, reconciliationSettlement: { ...settlement, id: "settlement:other" } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("CONFIRMED", "RECONCILED", { ...reconciled, reconciliationTransaction: { ...transaction, reconciliationId: "reconciliation:other" } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("CONFIRMED", "RECONCILED", { ...reconciled, actor: { actorId: "adapter:other", actorType: "ADAPTER" } })).toThrow(InvalidTransitionError);
    expect(transitionApplication("CONFIRMED", "RECONCILED", reconciled).state).toBe("RECONCILED");
  });
  it.each([
    ["INCOMPLETE", "NEEDS_REVIEW", "SYSTEM", "authorizedSystemId"], ["NEEDS_REVIEW", "INCOMPLETE", "SYSTEM", "authorizedSystemId"],
    ["NEEDS_REVIEW", "ELIGIBLE", "SYSTEM", "authorizedSystemId"], ["NEEDS_REVIEW", "REJECTED", "SYSTEM", "authorizedSystemId"],
    ["ELIGIBLE", "APPROVAL_PENDING", "SYSTEM", "authorizedSystemId"],
  ] as const)("authorizes the complete %s -> %s matrix", (from: "INCOMPLETE" | "NEEDS_REVIEW" | "ELIGIBLE" | "APPROVAL_PENDING" | "APPROVED" | "PREPARED" | "SUBMITTED" | "CONFIRMED", to: "INCOMPLETE" | "NEEDS_REVIEW" | "ELIGIBLE" | "APPROVAL_PENDING" | "APPROVED" | "PREPARED" | "SUBMITTED" | "CONFIRMED" | "REJECTED" | "FAILED" | "RECONCILED", actorType: "SYSTEM" | "FOUNDER" | "EVALUATOR" | "ADAPTER", identifier: string) => {
    const actor = { actorId: "authorized", actorType }; const authorized = { [identifier]: actor.actorId };
    expect(transitionApplication(from, to, { ...context, actor, ...authorized }).state).toBe(to);
    expect(() => transitionApplication(from, to, { ...context, actor: { ...actor, actorId: "wrong" }, ...authorized })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication(from, to, { ...context, actor })).toThrow(InvalidTransitionError);
  });
  it("separates exact evaluator approval from adapter terminal confirmation", async () => {
    const adapter = { actorId: "adapter:terminal", actorType: "ADAPTER" as const };
    const submittedCurrent = mockJob("SUBMITTED", mockTransaction("CONFIRMED", "JOB_SUBMIT"));
    const unconfirmedSubmittedCurrent = { ...submittedCurrent, transaction: mockTransaction("SUBMITTED", "JOB_SUBMIT") } as typeof submittedCurrent;
    const completed = mockJob("COMPLETED", mockTransaction("CONFIRMED", "JOB_EVALUATE"));
    const completedWithReason = AgenticJobRefSchema.parse({ ...completed, reasonReference: "mock:completion-attestation" });
    const rejected = mockJob("REJECTED", mockTransaction("CONFIRMED", "JOB_REJECT"), submittedCurrent.transaction);
    const reasonlessRejected = AgenticJobRefSchema.parse({ ...rejected, reasonReference: null });
    const completedAuthorization = await jobEvaluationAuthorization(completed, "APPROVED");
    const completedWithReasonAuthorization = await jobEvaluationAuthorization(completedWithReason, "APPROVED", "transaction:job-evaluate:approved-with-reason");
    const rejectedAuthorization = await jobEvaluationAuthorization(rejected, "REJECTED");
    const reasonlessRejectedAuthorization = await jobEvaluationAuthorization(reasonlessRejected, "REJECTED", "transaction:job-reject:reasonless");
    const completedContext = { ...context, aggregateId: completed.jobId, actor: adapter, authorizedAdapterId: adapter.actorId, currentJobEvidence: submittedCurrent, jobEvidence: completed, ...completedAuthorization };
    const completedWithReasonContext = { ...context, aggregateId: completedWithReason.jobId, actor: adapter, authorizedAdapterId: adapter.actorId, currentJobEvidence: submittedCurrent, jobEvidence: completedWithReason, ...completedWithReasonAuthorization };
    const rejectedContext = { ...context, aggregateId: rejected.jobId, actor: adapter, authorizedAdapterId: adapter.actorId, currentJobEvidence: submittedCurrent, jobEvidence: rejected, ...rejectedAuthorization };
    const reasonlessRejectedContext = { ...context, aggregateId: reasonlessRejected.jobId, actor: adapter, authorizedAdapterId: adapter.actorId, currentJobEvidence: submittedCurrent, jobEvidence: reasonlessRejected, ...reasonlessRejectedAuthorization };

    const completedResult = await transitionAgenticJob("SUBMITTED", "COMPLETED", completedContext);
    const completedWithReasonResult = await transitionAgenticJob("SUBMITTED", "COMPLETED", completedWithReasonContext);
    const rejectedResult = await transitionAgenticJob("SUBMITTED", "REJECTED", rejectedContext);
    const reasonlessRejectedResult = await transitionAgenticJob("SUBMITTED", "REJECTED", reasonlessRejectedContext);
    expect(completedResult.status).toBe("COMPLETED");
    expect(completedWithReasonResult.status).toBe("COMPLETED");
    expect(rejectedResult.status).toBe("REJECTED");
    expect(reasonlessRejectedResult.status).toBe("REJECTED");
    expect(completedResult.auditEvent.actor).toEqual(adapter);
    expect(rejectedResult.auditEvent.actor).toEqual(adapter);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, occurredAt: submittedCurrent.expiresAt })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "REJECTED", { ...rejectedContext, occurredAt: submittedCurrent.expiresAt })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, currentJobEvidence: unconfirmedSubmittedCurrent })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, executionBinding: undefined })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, idempotencyKey: undefined })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, submissionOperation: undefined })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, submissionOperation: { ...completedContext.submissionOperation, arcTransaction: { ...completedContext.submissionOperation.arcTransaction, transactionHash: "mock:unrelated-evaluation" } } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, submissionOperation: { ...completedContext.submissionOperation, arcTransaction: { ...completedContext.submissionOperation.arcTransaction, blockNumber: "2" } } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, submissionOperation: { ...completedContext.submissionOperation, arcTransaction: { ...completedContext.submissionOperation.arcTransaction, blockHash: "mock:other-block" } } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, submissionOperation: { ...completedContext.submissionOperation, arcTransaction: { ...completedContext.submissionOperation.arcTransaction, status: "FAILED", blockNumber: null, blockHash: null } } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, submissionOperation: { ...completedContext.submissionOperation, arcTransaction: { ...completedContext.submissionOperation.arcTransaction, status: "SUBMITTED", blockNumber: null, blockHash: null } } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "REJECTED", { ...rejectedContext, submissionOperation: { ...rejectedContext.submissionOperation, arcTransaction: { ...rejectedContext.submissionOperation.arcTransaction, status: "SUBMITTED", blockNumber: null, blockHash: null } } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, authorizedEvaluatorId: "mock:other-evaluator" })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, authorizedAdapterId: "adapter:other" })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, actor: { actorId: "mock:evaluator", actorType: "EVALUATOR" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, jobEvidence: { ...completed, deliverableReference: "mock:replacement" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, jobEvidence: { ...completed, reasonReference: "mock:unapproved-attestation" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "REJECTED", { ...rejectedContext, jobEvidence: { ...rejected, reasonReference: null } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "REJECTED", { ...rejectedContext, jobEvidence: { ...rejected, escrowTransaction: { ...submittedCurrent.transaction!, transactionHash: "mock:forged-prior-submission" } } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "REJECTED", { ...rejectedContext, jobEvaluationEvidence: { ...rejectedAuthorization.jobEvaluationEvidence, transactionHash: "mock:other" } })).rejects.toThrow(InvalidTransitionError);
    const evaluationTarget = completedAuthorization.executionBinding.executionIntent.protocolTarget;
    if (evaluationTarget.kind !== "ERC8183") throw new Error("Expected an ERC-8183 evaluation target.");
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, executionBinding: { ...completedAuthorization.executionBinding, executionIntent: { ...completedAuthorization.executionBinding.executionIntent, protocolTarget: { ...evaluationTarget, parameterCommitment: `sha256:${"a".repeat(64)}` } } } })).rejects.toThrow(InvalidTransitionError);
    const forgedEvaluationIntent = CanonicalExecutionIntentSchema.parse({ ...completedAuthorization.executionBinding.executionIntent, protocolTarget: { ...evaluationTarget, parameterCommitment: `sha256:${"a".repeat(64)}` } });
    const forgedEvaluationHash = await hashCanonicalExecutionIntent(forgedEvaluationIntent);
    const forgedEvaluationApproval = ApprovalRecordSchema.parse({ ...completedAuthorization.jobApprovalDecision, exactIntentHash: forgedEvaluationHash });
    const forgedEvaluationBinding = ExecutionAuthorizationBindingSchema.parse({ ...completedAuthorization.executionBinding, exactIntentHash: forgedEvaluationHash, executionIntent: forgedEvaluationIntent });
    const forgedEvaluationEvidence = JobEvaluationEvidenceSchema.parse({ ...completedAuthorization.jobEvaluationEvidence, exactIntentHash: forgedEvaluationHash });
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, jobApprovalDecision: forgedEvaluationApproval, executionBinding: forgedEvaluationBinding, jobEvaluationEvidence: forgedEvaluationEvidence, expectedExactIntentHash: forgedEvaluationHash })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, jobApprovalDecision: { ...completedAuthorization.jobApprovalDecision, expiresAt: context.occurredAt } })).rejects.toThrow(InvalidTransitionError);
  });
  it("models client and evaluator pre-submission rejection paths", async () => {
    const adapter = { actorId: "adapter:reject", actorType: "ADAPTER" as const };
    const open = mockJob("OPEN");
    const openRejected = AgenticJobRefSchema.parse({ ...mockJob("REJECTED", mockTransaction("CONFIRMED", "JOB_REJECT")), deliverableReference: null });
    const openAuthorization = await jobClientRejectionAuthorization(openRejected);
    const openContext = { ...context, aggregateId: open.jobId, actor: adapter, authorizedAdapterId: adapter.actorId, currentJobEvidence: open, jobEvidence: openRejected, ...openAuthorization };
    expect(openAuthorization.jobApprovalDecision.decision).toBe("APPROVED");
    expect((await transitionAgenticJob("OPEN", "REJECTED", openContext)).status).toBe("REJECTED");
    expect((await transitionAgenticJob("OPEN", "REJECTED", { ...openContext, occurredAt: open.expiresAt })).status).toBe("REJECTED");
    const openReasonlessRejected = AgenticJobRefSchema.parse({ ...openRejected, reasonReference: null });
    const openReasonlessContext = { ...openContext, jobEvidence: openReasonlessRejected, ...await jobClientRejectionAuthorization(openReasonlessRejected, "transaction:job-reject:client:reasonless") };
    expect((await transitionAgenticJob("OPEN", "REJECTED", openReasonlessContext)).status).toBe("REJECTED");
    await expect(transitionAgenticJob("OPEN", "REJECTED", { ...openContext, jobApprovalDecision: { ...openAuthorization.jobApprovalDecision, decision: "REJECTED" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("OPEN", "REJECTED", { ...openContext, authorizedApproverId: "mock:other-client" })).rejects.toThrow(InvalidTransitionError);
    const openEvaluatorAuthorization = await jobEvaluationAuthorization(openRejected, "REJECTED");
    await expect(transitionAgenticJob("OPEN", "REJECTED", { ...openContext, ...openEvaluatorAuthorization, authorizedApproverId: undefined })).rejects.toThrow(InvalidTransitionError);

    const funded = mockJob("FUNDED", mockTransaction("CONFIRMED", "JOB_FUND"));
    const fundedRejected = AgenticJobRefSchema.parse({ ...openRejected, escrowTransaction: funded.transaction });
    const fundedAuthorization = await jobEvaluationAuthorization(fundedRejected, "REJECTED");
    const fundedContext = { ...context, aggregateId: funded.jobId, actor: adapter, authorizedAdapterId: adapter.actorId, currentJobEvidence: funded, jobEvidence: fundedRejected, ...fundedAuthorization };
    expect(fundedAuthorization.jobApprovalDecision.decision).toBe("APPROVED");
    expect(fundedAuthorization.jobEvaluationEvidence.decision).toBe("REJECTED");
    expect((await transitionAgenticJob("FUNDED", "REJECTED", fundedContext)).status).toBe("REJECTED");
    const fundedReasonlessRejected = AgenticJobRefSchema.parse({ ...fundedRejected, reasonReference: null });
    const fundedReasonlessContext = { ...fundedContext, jobEvidence: fundedReasonlessRejected, ...await jobEvaluationAuthorization(fundedReasonlessRejected, "REJECTED", "transaction:job-reject:funded:reasonless") };
    expect((await transitionAgenticJob("FUNDED", "REJECTED", fundedReasonlessContext)).status).toBe("REJECTED");
    await expect(transitionAgenticJob("FUNDED", "REJECTED", { ...fu…23693 tokens truncated…Id: "release:2", reconciliationId, state: "RECONCILED" as const, transaction: mockTransaction("CONFIRMED", "REFUND") },
      { ...settlement, id: "settlement:rejected", projectId: seed.project.id, releaseRequestId: "release:3", reconciliationId, state: "RECONCILED" as const, job: rejectedJob, transaction: rejectedJob.transaction },
    ];
    const dispositions = filterBackerDisclosure({ project: seed.project, evidence: [], proofs: [], settlements: reconciled, preferences: { ...seed.disclosurePreferences, discloseSettlementState: true } }).settlements.map(({ disposition }) => disposition);
    expect(dispositions).toEqual(["SETTLEMENT", "SETTLEMENT", "REFUND", "REFUND"]);
    expect(() => filterBackerDisclosure({ project: seed.project, evidence: [], proofs: [], settlements: [{ ...settlement, id: "settlement:invalid-other", projectId: "project:other", state: "CONFIRMED" }], preferences: { ...seed.disclosurePreferences, discloseSettlementState: false } })).toThrow();
  });
  it("fails closed on malformed disclosure preferences", async () => {
    const seed = createPawPovAiSeed();
    expect(() => filterBackerDisclosure({ project: seed.project, evidence: [], proofs: [], settlements: [], preferences: { ...seed.disclosurePreferences, discloseSettlementState: "false" } as never })).toThrow();
  });
});

describe("PawPOVAI seed", () => {
  it("is reproducible and allocates exactly 1,000 test USDC", async () => {
    const first = createPawPovAiSeed(); const second = createPawPovAiSeed(); expect(first).toEqual(second); expect(first).not.toBe(second);
    expect(first.reserves.reduce((total, reserve) => total + BigInt(reserve.allocated.atomicUnits), 0n).toString()).toBe("1000000000");
    expect(first.vault.totalCapital.atomicUnits).toBe("1000000000"); expect(first.milestone.proposedAmount.atomicUnits).toBe("250000000");
    expect(first.requirements).toHaveLength(6); expect(first.disclosurePreferences.discloseProofRecords).toBe(false);
    expect(LaunchVaultSchema.parse(first.vault)).toEqual(first.vault); first.requirements.forEach((requirement) => expect(MilestoneRequirementSchema.parse(requirement)).toEqual(requirement));
  });
  it("rejects a vault whose declared asset differs from its total capital", async () => { const seed = createPawPovAiSeed(); expect(() => LaunchVaultSchema.parse({ ...seed.vault, asset: "EURC" })).toThrow(); });
  it.each(["EURC", "ETH", "TOKEN"])("rejects %s milestone proposal amounts", (asset: string) => { const seed = createPawPovAiSeed(); expect(() => MilestoneSchema.parse({ ...seed.milestone, proposedAmount: money(asset, "1") })).toThrow(); });
});

describe("LaunchVault treasury MVP slice", () => {
  const founder = { actorId: "founder:fictional", actorType: "FOUNDER" as const };
  const authorizedSystem = { actorId: "system:authorized", actorType: "SYSTEM" as const };
  const unauthorizedSystem = { actorId: "system:other", actorType: "SYSTEM" as const };
  const authorizedAdapter = { actorId: "adapter:authorized", actorType: "ADAPTER" as const };
  const unauthorizedAdapter = { actorId: "adapter:other", actorType: "ADAPTER" as const };
  const unauthorizedActors = [
    { actorId: "ai:agent", actorType: "AI" as const },
    { actorId: "backer:1", actorType: "BACKER" as const },
    founder,
    { actorId: "evaluator:1", actorType: "EVALUATOR" as const },
    unauthorizedSystem,
    unauthorizedAdapter,
  ];
  const setup = (mode: "MOCK" | "ARC_TESTNET" = "MOCK", authority: { actorType: "SYSTEM" | "ADAPTER"; actorId: string } = authorizedSystem) => {
    const seed = createPawPovAiSeed();
    const vault = LaunchVaultSchema.parse({ ...seed.vault, mode, totalCapital: mode === "ARC_TESTNET" ? usdc("0") : seed.vault.totalCapital });
    const emptyReserves = seed.reserves.map((reserve) => ReserveSchema.parse({
      id: reserve.id,
      vaultId: reserve.vaultId,
      name: reserve.name,
      allocated: usdc("0"),
      status: "PROPOSED",
    }));
    return {
      seed,
      treasury: new LaunchVaultTreasury({
        vault,
        reserves: emptyReserves,
        actor: authority,
        executionAuthority: authority,
        founderAuthority: founder,
      }),
    };
  };
  const buildApproval = async (proposal: ReturnType<LaunchVaultTreasury["createAllocationProposal"]>, overrides: Partial<ReturnType<typeof ApprovalRecordSchema.parse>> = {}) => ApprovalRecordSchema.parse({
    id: `approval:${proposal.id}`,
    aggregateId: proposal.id,
    intentId: `intent:${proposal.id}`,
    actionKind: "RELEASE_APPROVAL",
    authorizedActorType: "FOUNDER",
    authorizedActorId: founder.actorId,
    exactIntentHash: await hashAllocationProposalIntent(proposal),
    idempotencyKey: `approval:${proposal.id}:key`,
    decision: "APPROVED",
    approver: founder,
    expiresAt: "2027-01-01T00:00:00.000Z",
    decidedAt: context.occurredAt,
    ...overrides,
  });
  const expectNoMutation = async (treasury: LaunchVaultTreasury, action: () => Promise<unknown> | unknown) => {
    const before = treasury.getSnapshot();
    let threw = false;
    try {
      await action();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(treasury.getSnapshot()).toEqual(before);
  };

  it("keeps the seeded vault at exactly 1,000 test USDC atomic units and five reserve categories", async () => {
    const { seed, treasury } = setup();
    expect(seed.vault.totalCapital.atomicUnits).toBe("1000000000");
    const names = treasury.getSnapshot().reserves.map((reserve) => reserve.name).sort();
    expect(names).toEqual(["Contingency", "InvestFest travel", "Marketing", "Operations", "Product and platform"]);
  });

  it("initializes only from empty PROPOSED reserve definitions without changing the canonical seed", async () => {
    const seed = createPawPovAiSeed();
    const emptyReserves = seed.reserves.map((reserve) => ReserveSchema.parse({
      id: reserve.id,
      vaultId: reserve.vaultId,
      name: reserve.name,
      allocated: usdc("0"),
      status: "PROPOSED",
    }));
    const treasury = new LaunchVaultTreasury({
      vault: seed.vault,
      reserves: emptyReserves,
      actor: authorizedSystem,
      founderAuthority: founder,
    });
    expect(treasury.getSnapshot().reserves).toEqual(emptyReserves);
    expect(seed.reserves.map((reserve) => reserve.allocated.atomicUnits)).toEqual([
      "350000000", "250000000", "200000000", "100000000", "100000000",
    ]);

    for (const invalidReserve of [
      { ...emptyReserves[0]!, allocated: usdc("1") },
      { ...emptyReserves[0]!, status: "ACTIVE" as const },
      { ...emptyReserves[0]!, status: "CLOSED" as const },
    ]) {
      expect(() => new LaunchVaultTreasury({
        vault: seed.vault,
        reserves: [invalidReserve, ...emptyReserves.slice(1)],
        actor: authorizedSystem,
        founderAuthority: founder,
      })).toThrow(TreasuryError);
      expect(invalidReserve).not.toEqual(emptyReserves[0]);
    }
    expect(() => new LaunchVaultTreasury({
      vault: seed.vault,
      reserves: [emptyReserves[0]!, emptyReserves[0]!, ...emptyReserves.slice(2)],
      actor: authorizedSystem,
      founderAuthority: founder,
    })).toThrow(/defined more than once/);
  });

  it("requires explicit adapter authority for Arc Testnet while preserving mock system accounting", async () => {
    const seed = createPawPovAiSeed();
    const reserves = seed.reserves.map((reserve) => ReserveSchema.parse({ ...reserve, allocated: usdc("0"), status: "PROPOSED" }));
    expect(() => new LaunchVaultTreasury({ vault: seed.vault, reserves, actor: authorizedSystem, founderAuthority: founder })).not.toThrow();
    const liveVaultWithSeedCapital = LaunchVaultSchema.parse({ ...seed.vault, mode: "ARC_TESTNET" });
    expect(() => new LaunchVaultTreasury({ vault: liveVaultWithSeedCapital, reserves, actor: authorizedSystem, executionAuthority: authorizedAdapter, founderAuthority: founder })).toThrow(/must start at zero confirmed capital/);
    const liveVault = LaunchVaultSchema.parse({ ...seed.vault, mode: "ARC_TESTNET", totalCapital: usdc("0") });
    expect(() => new LaunchVaultTreasury({ vault: liveVault, reserves, actor: authorizedSystem, founderAuthority: founder })).toThrow(/explicitly configured/);
    expect(() => new LaunchVaultTreasury({ vault: liveVault, reserves, actor: authorizedSystem, executionAuthority: authorizedSystem, founderAuthority: founder })).toThrow(/explicit ADAPTER/);
    const treasury = new LaunchVaultTreasury({ vault: liveVault, reserves, actor: authorizedAdapter, executionAuthority: authorizedAdapter, founderAuthority: founder });
    await expect(treasury.recordIncomingTranche({ trancheId: "tranche:wrong-adapter", amount: usdc("1"), transactionRef: liveTransaction, actor: unauthorizedAdapter, idempotencyKey: "wrong-adapter", eventId: "audit:wrong-adapter", occurredAt: context.occurredAt })).rejects.toThrow(/exact authorized ADAPTER/);
  });

  it("normalizes null and undefined allocation source references as absent", async () => {
    const { treasury } = setup();
    const create = (proposalId: string, sourceJobRef: null | undefined, settlementTransactionRef: null | undefined) => treasury.createAllocationProposal({
      proposalId,
      instructions: [{ reserveId: "reserve:marketing", kind: "FIXED", atomicUnits: "1" }],
      actor: founder,
      eventId: `audit:${proposalId}`,
      occurredAt: context.occurredAt,
      sourceJobRef,
      settlementTransactionRef,
    });
    expect(create("proposal:null-sources", null, null)).toMatchObject({ sourceJobRef: null, settlementTransactionRef: null });
    expect(create("proposal:undefined-sources", undefined, undefined)).toMatchObject({ sourceJobRef: null, settlementTransactionRef: null });
  });

  it("keeps unapproved proposals from mutating active reserves and supports deterministic percentage rounding", async () => {
    const { treasury } = setup();
    expect(TreasuryAllocationRoundingPolicy).toContain("largest remainder");
    const proposal = treasury.createAllocationProposal({
      proposalId: "proposal:percent",
      instructions: [
        { reserveId: "reserve:product", kind: "FIXED", atomicUnits: "1" },
        { reserveId: "reserve:marketing", kind: "PERCENTAGE", basisPoints: 3333 },
        { reserveId: "reserve:travel", kind: "PERCENTAGE", basisPoints: 3333 },
        { reserveId: "reserve:operations", kind: "PERCENTAGE", basisPoints: 3334 },
      ],
      actor: founder,
      eventId: "audit:proposal:percent",
      occurredAt: context.occurredAt,
    });
    expect(proposal.status).toBe("PROPOSED");
    expect(proposal.resolvedAllocations.map((entry) => [entry.reserveId, entry.amount.atomicUnits])).toEqual([
      ["reserve:marketing", "333300000"],
      ["reserve:operations", "333399999"],
      ["reserve:product", "1"],
      ["reserve:travel", "333300000"],
    ]);
    expect(treasury.getSnapshot().reserves.every((reserve) => reserve.allocated.atomicUnits === "0")).toBe(true);
  });

  it("accepts zero fixed and zero-percentage instructions while rejecting percentage totals above 100%", async () => {
    const { treasury } = setup();
    const proposal = treasury.createAllocationProposal({
      proposalId: "proposal:zero",
      instructions: [
        { reserveId: "reserve:product", kind: "FIXED", atomicUnits: "0" },
        { reserveId: "reserve:marketing", kind: "PERCENTAGE", basisPoints: 0 },
      ],
      actor: founder,
      eventId: "audit:proposal:zero",
      occurredAt: context.occurredAt,
    });
    expect(proposal.resolvedAllocations.map((entry) => entry.amount.atomicUnits)).toEqual(["0", "0"]);
    expect(() => treasury.createAllocationProposal({
      proposalId: "proposal:too-much-percent",
      instructions: [
        { reserveId: "reserve:marketing", kind: "PERCENTAGE", basisPoints: 5001 },
        { reserveId: "reserve:operations", kind: "PERCENTAGE", basisPoints: 5000 },
      ],
      actor: founder,
      eventId: "audit:proposal:too-much-percent",
      occurredAt: context.occurredAt,
    })).toThrow(/Percentage allocation cannot exceed 100%/);
  });

  it("keeps mutations atomic when malformed event metadata or actor payload is provided", async () => {
    const { treasury } = setup();
    await expectNoMutation(treasury, () => treasury.recordEscrowedCapital({
      amount: usdc("1"),
      actor: authorizedSystem,
      idempotencyKey: "escrow:malformed-time",
      eventId: "audit:escrow:malformed-time",
      occurredAt: "not-a-timestamp",
    }));
    await expectNoMutation(treasury, () => treasury.recordEscrowedCapital({
      amount: usdc("1"),
      actor: { actorId: "system:authorized", actorType: "INVALID" } as never,
      idempotencyKey: "escrow:malformed-actor",
      eventId: "audit:escrow:malformed-actor",
      occurredAt: context.occurredAt,
    }));
    await expectNoMutation(treasury, () => treasury.createAllocationProposal({
      proposalId: "proposal:bad-event",
      instructions: [{ reserveId: "reserve:marketing", kind: "FIXED", atomicUnits: "1" }],
      actor: founder,
      eventId: "",
      occurredAt: context.occurredAt,
    }));
  });

  it("rejects duplicate escrow audit and ledger identities before financial mutation", async () => {
    const { treasury } = setup();
    await treasury.recordEscrowedCapital({
      amount: usdc("10"),
      actor: authorizedSystem,
      idempotencyKey: "escrow:duplicate:first",
      eventId: "audit:escrow:duplicate",
      occurredAt: context.occurredAt,
    });
    await expectNoMutation(treasury, () => treasury.recordEscrowedCapital({
      amount: usdc("5"),
      actor: authorizedSystem,
      idempotencyKey: "escrow:duplicate:second",
      eventId: "audit:escrow:duplicate",
      occurredAt: context.occurredAt,
    }));
    expect(treasury.getSnapshot().balances.escrowed.atomicUnits).toBe("10");
  });

  it("enforces exact operator authority for apply, escrow, tranche recording, and reconciliation", async () => {
    const { treasury } = setup("MOCK", authorizedSystem);
    const proposal = treasury.createAllocationProposal({
      proposalId: "proposal:authority",
      instructions: [{ reserveId: "reserve:marketing", kind: "FIXED", atomicUnits: "1" }],
      actor: founder,
      eventId: "audit:proposal:authority",
      occurredAt: context.occurredAt,
    });

    await treasury.approveAllocationProposal({
      proposalId: proposal.id,
      approval: await buildApproval(proposal),
      actor: founder,
      eventId: "audit:approval:authority",
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:authority",
      amount: usdc("1"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:authority",
      eventId: "audit:tranche:authority",
      occurredAt: context.occurredAt,
    });
    for (const actor of unauthorizedActors) {
      await expect(treasury.recordEscrowedCapital({ amount: usdc("1"), actor, idempotencyKey: `escrow:authority:${actor.actorType}`, eventId: `audit:escrow:authority:${actor.actorType}`, occurredAt: context.occurredAt })).rejects.toThrow(/exact authorized/);
      await expect(treasury.applyApprovedProposal({ proposalId: proposal.id, actor, idempotencyKey: `apply:authority:${actor.actorType}`, eventId: `audit:apply:authority:${actor.actorType}`, occurredAt: context.occurredAt })).rejects.toThrow(/exact authorized/);
      await expect(treasury.recordIncomingTranche({ trancheId: `tranche:unauthorized:${actor.actorType}`, amount: usdc("1"), transactionRef: mockTransaction("PREPARED", "SETTLEMENT"), actor, idempotencyKey: `tranche:unauthorized:${actor.actorType}`, eventId: `audit:tranche:unauthorized:${actor.actorType}`, occurredAt: context.occurredAt })).rejects.toThrow(/exact authorized/);
      await expect(treasury.reconcileConfirmedTranche({ trancheId: "tranche:authority", actor, idempotencyKey: `reconcile:authority:${actor.actorType}`, eventId: `audit:reconcile:authority:${actor.actorType}`, occurredAt: context.occurredAt })).rejects.toThrow(/exact authorized/);
    }
  });

  it("binds allocation approval authority to the configured founder ID", async () => {
    const { treasury } = setup();
    const proposal = treasury.createAllocationProposal({
      proposalId: "proposal:founder-authority",
      instructions: [{ reserveId: "reserve:marketing", kind: "FIXED", atomicUnits: "1" }],
      actor: founder,
      eventId: "audit:proposal:founder-authority",
      occurredAt: context.occurredAt,
    });
    const unrelatedFounder = { actorId: "founder:other", actorType: "FOUNDER" as const };
    await expect(treasury.approveAllocationProposal({
      proposalId: proposal.id,
      approval: await buildApproval(proposal, {
        authorizedActorId: unrelatedFounder.actorId,
        approver: unrelatedFounder,
      }),
      actor: unrelatedFounder,
      eventId: "audit:approval:founder-authority:unrelated",
      occurredAt: context.occurredAt,
    })).rejects.toThrow(/exact authorized FOUNDER actor/);
  });

  it("allows exactly one concurrent approval for a proposal", async () => {
    const { treasury } = setup();
    const proposal = treasury.createAllocationProposal({
      proposalId: "proposal:concurrent-approval",
      instructions: [{ reserveId: "reserve:marketing", kind: "FIXED", atomicUnits: "10" }],
      actor: founder,
      eventId: "audit:proposal:concurrent-approval",
      occurredAt: context.occurredAt,
    });
    const firstApproval = await buildApproval(proposal, { id: "approval:concurrent:first", idempotencyKey: "approval:concurrent:first:key" });
    const secondApproval = await buildApproval(proposal, { id: "approval:concurrent:second", idempotencyKey: "approval:concurrent:second:key" });
    const settled = await Promise.allSettled([
      treasury.approveAllocationProposal({ proposalId: proposal.id, approval: firstApproval, actor: founder, eventId: "audit:approval:concurrent:first", occurredAt: context.occurredAt }),
      treasury.approveAllocationProposal({ proposalId: proposal.id, approval: secondApproval, actor: founder, eventId: "audit:approval:concurrent:second", occurredAt: context.occurredAt }),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(treasury.getSnapshot().audit.filter((entry) => entry.details.nextState === "APPROVED")).toHaveLength(1);
  });

  it("rejects founder approvals decided before their proposal existed", async () => {
    const { treasury } = setup();
    const proposal = treasury.createAllocationProposal({
      proposalId: "proposal:predated-approval",
      instructions: [{ reserveId: "reserve:marketing", kind: "FIXED", atomicUnits: "10" }],
      actor: founder,
      eventId: "audit:proposal:predated-approval",
      occurredAt: "2026-01-02T00:00:00.000Z",
    });
    await expect(treasury.approveAllocationProposal({
      proposalId: proposal.id,
      approval: await buildApproval(proposal, { decidedAt: "2026-01-01T00:00:00.000Z" }),
      actor: founder,
      eventId: "audit:approval:predated-approval",
      occurredAt: "2026-01-02T00:00:00.000Z",
    })).rejects.toThrow(/chronology is invalid/);
    expect(treasury.getSnapshot().proposals.find((entry) => entry.id === proposal.id)?.status).toBe("PROPOSED");
  });

  it("allows exactly one concurrent application and applies balances and ledger entries once", async () => {
    const { treasury } = setup();
    const proposal = treasury.createAllocationProposal({
      proposalId: "proposal:concurrent-application",
      instructions: [{ reserveId: "reserve:marketing", kind: "FIXED", atomicUnits: "10" }],
      actor: founder,
      eventId: "audit:proposal:concurrent-application",
      occurredAt: context.occurredAt,
    });
    await treasury.approveAllocationProposal({
      proposalId: proposal.id,
      approval: await buildApproval(proposal),
      actor: founder,
      eventId: "audit:approval:concurrent-application",
      occurredAt: context.occurredAt,
    });
    const settled = await Promise.allSettled([
      treasury.applyApprovedProposal({ proposalId: proposal.id, actor: authorizedSystem, idempotencyKey: "apply:concurrent:first", eventId: "audit:apply:concurrent:first", occurredAt: context.occurredAt }),
      treasury.applyApprovedProposal({ proposalId: proposal.id, actor: authorizedSystem, idempotencyKey: "apply:concurrent:second", eventId: "audit:apply:concurrent:second", occurredAt: context.occurredAt }),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    const snapshot = treasury.getSnapshot();
    expect(snapshot.reserves.find((reserve) => reserve.id === "reserve:marketing")?.allocated.atomicUnits).toBe("10");
    expect(snapshot.ledger.filter((entry) => entry.kind === "ALLOCATION" && entry.reserveId === "reserve:marketing")).toHaveLength(1);
  });

  it("prevents allocated-plus-escrow overcommit against confirmed capital", async () => {
    const { treasury } = setup();
    const proposal = treasury.createAllocationProposal({
      proposalId: "proposal:allocated",
      instructions: [{ reserveId: "reserve:marketing", kind: "FIXED", atomicUnits: "900000000" }],
      actor: founder,
      eventId: "audit:proposal:allocated",
      occurredAt: context.occurredAt,
    });
    await treasury.approveAllocationProposal({ proposalId: proposal.id, approval: await buildApproval(proposal), actor: founder, eventId: "audit:approval:allocated", occurredAt: context.occurredAt });
    await treasury.applyApprovedProposal({ proposalId: proposal.id, actor: authorizedSystem, idempotencyKey: "apply:allocated", eventId: "audit:apply:allocated", occurredAt: context.occurredAt });
    await expect(treasury.recordEscrowedCapital({ amount: usdc("100000001"), actor: authorizedSystem, idempotencyKey: "escrow:overcommit", eventId: "audit:escrow:overcommit", occurredAt: context.occurredAt })).rejects.toThrow(/cannot exceed unallocated confirmed capital/);
  });

  it("requires explicit, valid escrow reversal targets and preserves append-only history", async () => {
    const { treasury: treasuryA } = setup();
    const { treasury: treasuryB } = setup();
    await treasuryA.recordEscrowedCapital({ amount: usdc("10"), actor: authorizedSystem, idempotencyKey: "escrow:record:a", eventId: "audit:escrow:record:a", occurredAt: context.occurredAt });
    await treasuryA.recordEscrowedCapital({ amount: usdc("5"), actor: authorizedSystem, idempotencyKey: "escrow:record:b", eventId: "audit:escrow:record:b", occurredAt: context.occurredAt });
    await treasuryA.recordEscrowedCapital({ amount: usdc("10"), actor: authorizedSystem, idempotencyKey: "escrow:record:c", eventId: "audit:escrow:record:c", occurredAt: context.occurredAt });
    await treasuryB.recordEscrowedCapital({ amount: usdc("1"), actor: authorizedSystem, idempotencyKey: "escrow:record:other", eventId: "audit:escrow:record:other", occurredAt: context.occurredAt });
    const commitmentA = treasuryA.getSnapshot().ledger.find((entry) => entry.id === "ledger:escrow:audit:escrow:record:a");
    const commitmentB = treasuryA.getSnapshot().ledger.find((entry) => entry.id === "ledger:escrow:audit:escrow:record:b");
    if (commitmentA === undefined || commitmentB === undefined) throw new Error("Missing staged commitments.");
    await expect(treasuryA.releaseEscrowedCapital({ amount: usdc("1"), actor: authorizedSystem, idempotencyKey: "escrow:release:missing", eventId: "audit:escrow:release:missing", occurredAt: context.occurredAt, reversesEntryId: "ledger:missing" })).rejects.toThrow(/target does not exist/);
    await expect(treasuryA.releaseEscrowedCapital({ amount: money("EURC", "1"), actor: authorizedSystem, idempotencyKey: "escrow:release:wrong-asset", eventId: "audit:escrow:release:wrong-asset", occurredAt: context.occurredAt, reversesEntryId: commitmentA.id })).rejects.toThrow();
    await expect(treasuryA.releaseEscrowedCapital({ amount: usdc("1"), actor: authorizedSystem, idempotencyKey: "escrow:release:wrong-target", eventId: "audit:escrow:release:wrong-target", occurredAt: context.occurredAt, reversesEntryId: "ledger:seed-capital" })).rejects.toThrow(/must reverse a COMMITMENT/);
    await expect(treasuryB.releaseEscrowedCapital({ amount: usdc("1"), actor: authorizedSystem, idempotencyKey: "escrow:release:wrong-vault", eventId: "audit:escrow:release:wrong-vault", occurredAt: context.occurredAt, reversesEntryId: commitmentA.id })).rejects.toThrow(/target does not exist/);
    await treasuryA.releaseEscrowedCapital({ amount: usdc("4"), actor: authorizedSystem, idempotencyKey: "escrow:release:partial", eventId: "audit:escrow:release:partial", occurredAt: context.occurredAt, reversesEntryId: commitmentA.id });
    await expectNoMutation(treasuryA, () => treasuryA.releaseEscrowedCapital({ amount: usdc("1"), actor: authorizedSystem, idempotencyKey: "escrow:release:duplicate-event", eventId: "audit:escrow:release:partial", occurredAt: context.occurredAt, reversesEntryId: commitmentA.id }));
    await treasuryA.releaseEscrowedCapital({ amount: usdc("6"), actor: authorizedSystem, idempotencyKey: "escrow:release:full", eventId: "audit:escrow:release:full", occurredAt: context.occurredAt, reversesEntryId: commitmentA.id });
    await expect(treasuryA.releaseEscrowedCapital({ amount: usdc("1"), actor: authorizedSystem, idempotencyKey: "escrow:release:double", eventId: "audit:escrow:release:double", occurredAt: context.occurredAt, reversesEntryId: commitmentA.id })).rejects.toThrow(/remaining commitment amount/);
    await expect(treasuryA.releaseEscrowedCapital({ amount: usdc("6"), actor: authorizedSystem, idempotencyKey: "escrow:release:over", eventId: "audit:escrow:release:over", occurredAt: context.occurredAt, reversesEntryId: commitmentB.id })).rejects.toThrow(/remaining commitment amount/);
    const reversals = treasuryA.getSnapshot().ledger.filter((entry) => entry.kind === "REVERSAL");
    expect(reversals).toHaveLength(2);
    expect(reversals.every((entry) => entry.reversesEntryId === commitmentA.id)).toBe(true);
  });

  it("requires reconciled settlement evidence for proposal sources and preserves source job/transaction references", async () => {
    const { treasury } = setup();
    expect(() => treasury.createAllocationProposal({
      proposalId: "proposal:raw-settlement",
      instructions: [{ reserveId: "reserve:marketing", kind: "FIXED", atomicUnits: "1" }],
      actor: founder,
      eventId: "audit:proposal:raw-settlement",
      occurredAt: context.occurredAt,
      settlementTransactionRef: mockTransaction("CONFIRMED", "SETTLEMENT"),
    })).toThrow(/explicit reconciled tranche ID|persisted reconciled incoming tranche/);
    const job = AgenticJobRefSchema.parse({ ...mockJob("COMPLETED", mockTransaction("CONFIRMED", "JOB_EVALUATE")), budget: usdc("250000000") });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:settlement-source",
      amount: usdc("250000000"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      sourceJobRef: job,
      actor: authorizedSystem,
      idempotencyKey: "tranche:settlement-source:prepared",
      eventId: "audit:tranche:settlement-source:prepared",
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:settlement-source",
      amount: usdc("250000000"),
      transactionRef: { ...mockTransaction("SUBMITTED", "SETTLEMENT"), transactionHash: "mock:transaction:settlement-source" },
      sourceJobRef: job,
      actor: authorizedSystem,
      idempotencyKey: "tranche:settlement-source:submitted",
      eventId: "audit:tranche:settlement-source:submitted",
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:settlement-source",
      amount: usdc("250000000"),
      transactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: "mock:transaction:settlement-source" },
      sourceJobRef: job,
      actor: authorizedSystem,
      idempotencyKey: "tranche:settlement-source:confirmed",
      eventId: "audit:tranche:settlement-source:confirmed",
      occurredAt: context.occurredAt,
    });
    await treasury.reconcileConfirmedTranche({ trancheId: "tranche:settlement-source", actor: authorizedSystem, idempotencyKey: "reconcile:settlement-source", eventId: "audit:reconcile:settlement-source", occurredAt: context.occurredAt });
    const proposal = treasury.createAllocationProposal({
      proposalId: "proposal:settlement-source",
      instructions: [{ reserveId: "reserve:marketing", kind: "FIXED", atomicUnits: "1" }],
      actor: founder,
      eventId: "audit:proposal:settlement-source",
      occurredAt: context.occurredAt,
      sourceTrancheId: "tranche:settlement-source",
      settlementTransactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: "mock:transaction:settlement-source" },
      sourceJobRef: job,
    });
    expect(proposal.sourceTrancheId).toBe("tranche:settlement-source");
    expect(proposal.sourceJobRef?.jobId).toBe(job.jobId);
    expect(() => treasury.createAllocationProposal({
      proposalId: "proposal:wrong-job",
      instructions: [{ reserveId: "reserve:marketing", kind: "FIXED", atomicUnits: "1" }],
      actor: founder,
      eventId: "audit:proposal:wrong-job",
      occurredAt: context.occurredAt,
      sourceTrancheId: "tranche:settlement-source",
      settlementTransactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: "mock:transaction:settlement-source" },
      sourceJobRef: AgenticJobRefSchema.parse({ ...job, jobId: "mock:job:other" }),
    })).toThrow(/does not match the reconciled tranche/);
  });

  it("bounds allocation provenance to one reconciled source tranche without changing unsourced budgets", async () => {
    const { treasury } = setup();
    const settlement = { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: "mock:transaction:provenance" };
    await treasury.recordIncomingTranche({
      trancheId: "tranche:provenance",
      amount: usdc("100"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:provenance:prepared",
      eventId: "audit:tranche:provenance:prepared",
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:provenance",
      amount: usdc("100"),
      transactionRef: { ...mockTransaction("SUBMITTED", "SETTLEMENT"), transactionHash: settlement.transactionHash },
      actor: authorizedSystem,
      idempotencyKey: "tranche:provenance:submitted",
      eventId: "audit:tranche:provenance:submitted",
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:provenance",
      amount: usdc("100"),
      transactionRef: settlement,
      actor: authorizedSystem,
      idempotencyKey: "tranche:provenance:confirmed",
      eventId: "audit:tranche:provenance:confirmed",
      occurredAt: context.occurredAt,
    });
    await treasury.reconcileConfirmedTranche({ trancheId: "tranche:provenance", actor: authorizedSystem, idempotencyKey: "reconcile:provenance", eventId: "audit:reconcile:provenance", occurredAt: context.occurredAt });

    expect(() => treasury.createAllocationProposal({
      proposalId: "proposal:provenance:over",
      instructions: [{ reserveId: "reserve:marketing", kind: "FIXED", atomicUnits: "600" }],
      actor: founder,
      eventId: "audit:proposal:provenance:over",
      occurredAt: context.occurredAt,
      sourceTrancheId: "tranche:provenance",
      settlementTransactionRef: settlement,
    })).toThrow(/exceed/);
    const sourced = treasury.createAllocationProposal({
      proposalId: "proposal:provenance:bounded",
      instructions: [{ reserveId: "reserve:marketing", kind: "FIXED", atomicUnits: "100" }],
      actor: founder,
      eventId: "audit:proposal:provenance:bounded",
      occurredAt: context.occurredAt,
      sourceTrancheId: "tranche:provenance",
      settlementTransactionRef: settlement,
    });
    expect(sourced.resolvedAllocations[0]?.amount.atomicUnits).toBe("100");
    expect(() => treasury.createAllocationProposal({
      proposalId: "proposal:provenance:reuse",
      instructions: [{ reserveId: "reserve:travel", kind: "FIXED", atomicUnits: "1" }],
      actor: founder,
      eventId: "audit:proposal:provenance:reuse",
      occurredAt: context.occurredAt,
      sourceTrancheId: "tranche:provenance",
      settlementTransactionRef: settlement,
    })).toThrow(/already bound/);

    const unsourced = treasury.createAllocationProposal({
      proposalId: "proposal:unsourced:normal-budget",
      instructions: [{ reserveId: "reserve:operations", kind: "FIXED", atomicUnits: "600" }],
      actor: founder,
      eventId: "audit:proposal:unsourced:normal-budget",
      occurredAt: context.occurredAt,
    });
    expect(unsourced.resolvedAllocations[0]?.amount.atomicUnits).toBe("600");
  });

  it("rejects non-SETTLEMENT tranche transactions and rejects downgrade/hash/source substitution", async () => {
    const { treasury } = setup();
    await expect(treasury.recordIncomingTranche({
      trancheId: "tranche:refund",
      amount: usdc("1"),
      transactionRef: mockTransaction("CONFIRMED", "REFUND"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:refund",
      eventId: "audit:tranche:refund",
      occurredAt: context.occurredAt,
    })).rejects.toThrow(/SETTLEMENT transaction type/);
    await expect(treasury.recordIncomingTranche({
      trancheId: "tranche:fresh-submitted",
      amount: usdc("1"),
      transactionRef: { ...mockTransaction("SUBMITTED", "SETTLEMENT"), transactionHash: "mock:transaction:fresh-submitted" },
      actor: authorizedSystem,
      idempotencyKey: "tranche:fresh-submitted",
      eventId: "audit:tranche:fresh-submitted",
      occurredAt: context.occurredAt,
    })).rejects.toThrow(/must start in PREPARED state/);
    await expect(treasury.recordIncomingTranche({
      trancheId: "tranche:fresh-confirmed",
      amount: usdc("1"),
      transactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: "mock:transaction:fresh-confirmed" },
      actor: authorizedSystem,
      idempotencyKey: "tranche:fresh-confirmed",
      eventId: "audit:tranche:fresh-confirmed",
      occurredAt: context.occurredAt,
    })).rejects.toThrow(/must start in PREPARED state/);
    const prepared = await treasury.recordIncomingTranche({
      trancheId: "tranche:progression",
      amount: usdc("10"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:prepared",
      eventId: "audit:tranche:prepared",
      occurredAt: context.occurredAt,
    });
    expect(prepared.state).toBe("PREPARED");
    expect(prepared.state).not.toBe("SUBMITTED");
    const submitted = await treasury.recordIncomingTranche({
      trancheId: "tranche:progression",
      amount: usdc("10"),
      transactionRef: {
  ...mockTransaction("SUBMITTED", "SETTLEMENT"),
  transactionHash: "mock:transaction:progression",
},
      actor: authorizedSystem,
      idempotencyKey: "tranche:submitted",
      eventId: "audit:tranche:submitted",
      occurredAt: context.occurredAt,
    });
    expect(submitted.state).toBe("SUBMITTED");
    expect(treasury.getSnapshot().audit).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({ previousState: "PREPARED", nextState: "SUBMITTED" }),
    }));
    await expect(treasury.recordIncomingTranche({
      trancheId: "tranche:progression",
      amount: usdc("10"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:downgrade",
      eventId: "audit:tranche:downgrade",
      occurredAt: context.occurredAt,
    })).rejects.toThrow(/cannot move backward/);
    await expectNoMutation(treasury, () => treasury.recordIncomingTranche({
      trancheId: "tranche:progression",
      amount: usdc("10"),
      transactionRef: { ...mockTransaction("SUBMITTED", "SETTLEMENT"), chainId: "mock:other-chain", transactionHash: "mock:transaction:progression" },
      actor: authorizedSystem,
      idempotencyKey: "tranche:cross-chain",
      eventId: "audit:tranche:cross-chain",
      occurredAt: context.occurredAt,
    }));
    await expect(treasury.recordIncomingTranche({
      trancheId: "tranche:progression",
      amount: usdc("10"),
      transactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: "mock:other-hash" },
      actor: authorizedSystem,
      idempotencyKey: "tranche:hash-substitution",
      eventId: "audit:tranche:hash-substitution",
      occurredAt: context.occurredAt,
    })).rejects.toThrow(/cannot be substituted/);
    const confirmed = await treasury.recordIncomingTranche({
      trancheId: "tranche:progression",
      amount: usdc("10"),
      transactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: "mock:transaction:progression" },
      actor: authorizedSystem,
      idempotencyKey: "tranche:confirmed",
      eventId: "audit:tranche:confirmed",
      occurredAt: context.occurredAt,
    });
    expect(confirmed.state).toBe("CONFIRMED");
    await treasury.recordIncomingTranche({
      trancheId: "tranche:confirmed-freeze",
      amount: usdc("7"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:confirmed-freeze:prepared",
      eventId: "audit:tranche:confirmed-freeze:prepared",
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:confirmed-freeze",
      amount: usdc("7"),
      transactionRef: {
        ...mockTransaction("SUBMITTED", "SETTLEMENT"),
        transactionHash: "mock:transaction:confirmed-freeze",
      },
      actor: authorizedSystem,
      idempotencyKey: "tranche:confirmed-freeze:submitted",
      eventId: "audit:tranche:confirmed-freeze:submitted",
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:confirmed-freeze",
      amount: usdc("7"),
      transactionRef: {
        ...mockTransaction("CONFIRMED", "SETTLEMENT"),
        transactionHash: "mock:transaction:confirmed-freeze",
      },
      actor: authorizedSystem,
      idempotencyKey: "tranche:confirmed-freeze:confirmed",
      eventId: "audit:tranche:confirmed-freeze:confirmed",
      occurredAt: context.occurredAt,
    });
    await expect(treasury.recordIncomingTranche({
      trancheId: "tranche:confirmed-freeze",
      amount: usdc("7"),
      transactionRef: {
  ...mockTransaction("CONFIRMED", "SETTLEMENT"),
  transactionHash: "mock:transaction:confirmed-freeze",
  blockNumber: "2",
},
      actor: authorizedSystem,
      idempotencyKey: "tranche:confirmed-freeze:altered",
      eventId: "audit:tranche:confirmed-freeze:altered",
      occurredAt: context.occurredAt,
    })).rejects.toThrow(/cannot be altered/);
    const sourceJob = AgenticJobRefSchema.parse({ ...mockJob("COMPLETED", mockTransaction("CONFIRMED", "JOB_EVALUATE")), budget: usdc("10") });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:job-source",
      amount: usdc("10"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      sourceJobRef: sourceJob,
      actor: authorizedSystem,
      idempotencyKey: "tranche:job-source",
      eventId: "audit:tranche:job-source",
      occurredAt: context.occurredAt,
    });
    await expect(treasury.recordIncomingTranche({
      trancheId: "tranche:job-source",
      amount: usdc("10"),
     transactionRef: {
  ...mockTransaction("SUBMITTED", "SETTLEMENT"),
  transactionHash: "mock:transaction:job-source",
},
      sourceJobRef: AgenticJobRefSchema.parse({ ...sourceJob, jobId: "mock:job:changed" }),
      actor: authorizedSystem,
      idempotencyKey: "tranche:job-substitution",
      eventId: "audit:tranche:job-substitution",
      occurredAt: context.occurredAt,
    })).rejects.toThrow(/source job evidence cannot be substituted/);
    await expect(treasury.recordIncomingTranche({
      trancheId: "tranche:job-source",
      amount: usdc("10"),
      transactionRef: {
  ...mockTransaction("SUBMITTED", "SETTLEMENT"),
  transactionHash: "mock:transaction:job-source",
},
      sourceJobRef: AgenticJobRefSchema.parse({ ...sourceJob, budget: usdc("9") }),
      actor: authorizedSystem,
      idempotencyKey: "tranche:job-substitution:budget",
      eventId: "audit:tranche:job-substitution:budget",
      occurredAt: context.occurredAt,
    })).rejects.toThrow(/must exactly match source job budget/);
    await expect(treasury.recordIncomingTranche({
      trancheId: "tranche:job-amount-mismatch",
      amount: usdc("11"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      sourceJobRef: sourceJob,
      actor: authorizedSystem,
      idempotencyKey: "tranche:job-amount-mismatch",
      eventId: "audit:tranche:job-amount-mismatch",
      occurredAt: context.occurredAt,
    })).rejects.toThrow(/must exactly match source job budget/);
  });

  it("rejects duplicate settlement transaction hashes across tranche IDs", async () => {
    const { treasury } = setup();
    await treasury.recordIncomingTranche({
      trancheId: "tranche:hash-a",
      amount: usdc("5"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:hash-a:prepared",
      eventId: "audit:tranche:hash-a:prepared",
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:hash-a",
      amount: usdc("5"),
      transactionRef: { ...mockTransaction("SUBMITTED", "SETTLEMENT"), transactionHash: "mock:transaction:hash-a" },
      actor: authorizedSystem,
      idempotencyKey: "tranche:hash-a:submitted",
      eventId: "audit:tranche:hash-a:submitted",
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:hash-a",
      amount: usdc("5"),
      transactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: "mock:transaction:hash-a" },
      actor: authorizedSystem,
      idempotencyKey: "tranche:hash-a:confirmed",
      eventId: "audit:tranche:hash-a:confirmed",
      occurredAt: context.occurredAt,
    });
    await treasury.reconcileConfirmedTranche({
      trancheId: "tranche:hash-a",
      actor: authorizedSystem,
      idempotencyKey: "reconcile:hash-a",
      eventId: "audit:reconcile:hash-a",
      occurredAt: context.occurredAt,
    });
    await expect(treasury.recordIncomingTranche({
      trancheId: "tranche:hash-b",
      amount: usdc("5"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:hash-b:prepared",
      eventId: "audit:tranche:hash-b:prepared",
      occurredAt: context.occurredAt,
    })).resolves.toBeDefined();
    await expect(treasury.recordIncomingTranche({
      trancheId: "tranche:hash-b",
      amount: usdc("5"),
      transactionRef: { ...mockTransaction("SUBMITTED", "SETTLEMENT"), transactionHash: "mock:transaction:hash-a" },
      actor: authorizedSystem,
      idempotencyKey: "tranche:hash-b",
      eventId: "audit:tranche:hash-b",
      occurredAt: context.occurredAt,
    })).rejects.toThrow(/already bound to another tranche/);
  });

  it("deduplicates settlement transaction hashes using canonical casing", async () => {
    const { treasury } = setup();
    const lowercaseHash = `mock:transaction:0x${"ab".repeat(32)}`;
    const uppercaseHash = `mock:transaction:0x${"AB".repeat(32)}`;
    await treasury.recordIncomingTranche({
      trancheId: "tranche:canonical-hash-a",
      amount: usdc("5"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:canonical-hash-a:prepared",
      eventId: "audit:tranche:canonical-hash-a:prepared",
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:canonical-hash-a",
      amount: usdc("5"),
      transactionRef: {
        ...mockTransaction("SUBMITTED", "SETTLEMENT"),
        transactionHash: lowercaseHash,
      },
      actor: authorizedSystem,
      idempotencyKey: "tranche:canonical-hash-a",
      eventId: "audit:tranche:canonical-hash-a",
      occurredAt: context.occurredAt,
    });
    await expect(treasury.recordIncomingTranche({
      trancheId: "tranche:canonical-hash-b",
      amount: usdc("5"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:canonical-hash-b:prepared",
      eventId: "audit:tranche:canonical-hash-b:prepared",
      occurredAt: context.occurredAt,
    })).resolves.toBeDefined();
    await expect(treasury.recordIncomingTranche({
      trancheId: "tranche:canonical-hash-b",
      amount: usdc("5"),
      transactionRef: {
        ...mockTransaction("SUBMITTED", "SETTLEMENT"),
        transactionHash: uppercaseHash,
      },
      actor: authorizedSystem,
      idempotencyKey: "tranche:canonical-hash-b",
      eventId: "audit:tranche:canonical-hash-b",
      occurredAt: context.occurredAt,
    })).rejects.toThrow(/already bound to another tranche/);
  });

  it("persists failed incoming tranche evidence without allowing reconciliation", async () => {
    const { treasury } = setup();
    await treasury.recordIncomingTranche({
      trancheId: "tranche:failed",
      amount: usdc("5"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:failed:prepared",
      eventId: "audit:tranche:failed:prepared",
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:failed",
      amount: usdc("5"),
      transactionRef: { ...mockTransaction("SUBMITTED", "SETTLEMENT"), transactionHash: "mock:transaction:failed" },
      actor: authorizedSystem,
      idempotencyKey: "tranche:failed:submitted",
      eventId: "audit:tranche:failed:submitted",
      occurredAt: context.occurredAt,
    });
    const failed = await treasury.recordIncomingTranche({
      trancheId: "tranche:failed",
      amount: usdc("5"),
      transactionRef: { ...mockTransaction("FAILED", "SETTLEMENT"), transactionHash: "mock:transaction:failed" },
      actor: authorizedSystem,
      idempotencyKey: "tranche:failed",
      eventId: "audit:tranche:failed",
      occurredAt: context.occurredAt,
    });
    expect(failed.state).toBe("FAILED");
    expect(treasury.getSnapshot().incomingTranches).toContainEqual(failed);
    await expect(treasury.recordIncomingTranche({
      trancheId: failed.id,
      amount: failed.amount,
      transactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: "mock:transaction:failed" },
      actor: authorizedSystem,
      idempotencyKey: "tranche:failed:terminal",
      eventId: "audit:tranche:failed:terminal",
      occurredAt: context.occurredAt,
    })).rejects.toThrow(/Failed tranches cannot be modified/);
    await expect(treasury.reconcileConfirmedTranche({
      trancheId: failed.id,
      actor: authorizedSystem,
      idempotencyKey: "reconcile:failed",
      eventId: "audit:reconcile:failed",
      occurredAt: context.occurredAt,
    })).rejects.toThrow(/Only CONFIRMED tranches/);
  });

  it("revalidates approval chronology and exact intent at apply time", async () => {
    const { treasury } = setup();
    const proposal = treasury.createAllocationProposal({
      proposalId: "proposal:expired-approval",
      instructions: [{ reserveId: "reserve:marketing", kind: "FIXED", atomicUnits: "10" }],
      actor: founder,
      eventId: "audit:proposal:expired-approval",
      occurredAt: "2025-12-30T00:00:00.000Z",
    });
    await treasury.approveAllocationProposal({
      proposalId: proposal.id,
      approval: await buildApproval(proposal, { expiresAt: "2026-01-01T00:00:00.000Z", decidedAt: "2025-12-31T00:00:00.000Z" }),
      actor: founder,
      eventId: "audit:approval:expired-approval",
      occurredAt: "2025-12-31T00:00:00.000Z",
    });
    await expect(treasury.applyApprovedProposal({
      proposalId: proposal.id,
      actor: authorizedSystem,
      idempotencyKey: "apply:expired-approval",
      eventId: "audit:apply:expired-approval",
      occurredAt: "2026-01-01T00:00:00.000Z",
    })).rejects.toThrow(/no longer valid at apply time/);
  });

  it("applies all five PawPOVAI reserve allocations exactly once with idempotent duplicate protection", async () => {
    const { treasury } = setup();
    const proposal = treasury.createAllocationProposal({
      proposalId: "proposal:five-reserves",
      instructions: [
        { reserveId: "reserve:product", kind: "FIXED", atomicUnits: "300000000" },
        { reserveId: "reserve:marketing", kind: "FIXED", atomicUnits: "200000000" },
        { reserveId: "reserve:travel", kind: "FIXED", atomicUnits: "100000000" },
        { reserveId: "reserve:operations", kind: "FIXED", atomicUnits: "250000000" },
        { reserveId: "reserve:contingency", kind: "FIXED", atomicUnits: "150000000" },
      ],
      actor: founder,
      eventId: "audit:proposal:five-reserves",
      occurredAt: context.occurredAt,
    });
    await treasury.approveAllocationProposal({ proposalId: proposal.id, approval: await buildApproval(proposal), actor: founder, eventId: "audit:approval:five-reserves", occurredAt: context.occurredAt });
    const first = await treasury.applyApprovedProposal({ proposalId: proposal.id, actor: authorizedSystem, idempotencyKey: "apply:five-reserves", eventId: "audit:apply:five-reserves", occurredAt: context.occurredAt });
    const duplicate = await treasury.applyApprovedProposal({ proposalId: proposal.id, actor: authorizedSystem, idempotencyKey: "apply:five-reserves", eventId: "audit:apply:five-reserves:duplicate", occurredAt: context.occurredAt });
    expect(first).toEqual(duplicate);
    await expect(treasury.applyApprovedProposal({ proposalId: proposal.id, actor: authorizedSystem, idempotencyKey: "apply:five-reserves:other", eventId: "audit:apply:five-reserves:other", occurredAt: context.occurredAt })).rejects.toThrow();
    expect(treasury.getSnapshot().reserves.map((reserve) => reserve.allocated.atomicUnits)).toEqual(["300000000", "200000000", "100000000", "250000000", "150000000"]);
  });

  it("keeps tranche recording idempotent: exact retry returns same result without duplicating audit or state", async () => {
    const { treasury } = setup();
    const first = await treasury.recordIncomingTranche({
      trancheId: "tranche:idempotent",
      amount: usdc("5"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:idempotent:prepared",
      eventId: "audit:tranche:idempotent:prepared",
      occurredAt: context.occurredAt,
    });
    const retry = await treasury.recordIncomingTranche({
      trancheId: "tranche:idempotent",
      amount: usdc("5"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:idempotent:prepared",
      eventId: "audit:tranche:idempotent:prepared:retry",
      occurredAt: context.occurredAt,
    });
    expect(first).toEqual(retry);
    const snapshot = treasury.getSnapshot();
    const trancheAuditEvents = snapshot.audit.filter((e) => e.aggregateId === "tranche:idempotent");
    expect(trancheAuditEvents).toHaveLength(1);
    expect(snapshot.incomingTranches.filter((t) => t.id === "tranche:idempotent")).toHaveLength(1);
    expect(snapshot.incomingTranches.find((t) => t.id === "tranche:idempotent")?.state).toBe("PREPARED");
  });

  it("rejects same idempotency key reused with a different tranche fingerprint", async () => {
    const { treasury } = setup();
    await treasury.recordIncomingTranche({
      trancheId: "tranche:conflict-key",
      amount: usdc("5"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:conflict-key:prepared",
      eventId: "audit:tranche:conflict-key:prepared",
      occurredAt: context.occurredAt,
    });
    // Same idempotency key but different trancheId → fingerprint conflict
    await expect(treasury.recordIncomingTranche({
      trancheId: "tranche:conflict-key-other",
      amount: usdc("5"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:conflict-key:prepared",
      eventId: "audit:tranche:conflict-key-other:prepared",
      occurredAt: context.occurredAt,
    })).rejects.toThrow();
    // Only the original tranche exists; the conflicting call left no trace
    const snapshot = treasury.getSnapshot();
    expect(snapshot.incomingTranches.map((t) => t.id)).not.toContain("tranche:conflict-key-other");
    expect(snapshot.incomingTranches.map((t) => t.id)).toContain("tranche:conflict-key");
  });

  it("rejects a different idempotency key reusing an existing eventId and leaves vault unchanged", async () => {
    const { treasury } = setup();
    const eventId = "audit:tranche:dup-eventid:prepared";
    await treasury.recordIncomingTranche({
      trancheId: "tranche:dup-eventid",
      amount: usdc("5"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:dup-eventid:key1",
      eventId,
      occurredAt: context.occurredAt,
    });
    const snapshotBefore = treasury.getSnapshot();
    // Different idempotency key but same eventId — must be rejected
    await expect(treasury.recordIncomingTranche({
      trancheId: "tranche:dup-eventid-other",
      amount: usdc("7"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:dup-eventid:key2",
      eventId,
      occurredAt: context.occurredAt,
    })).rejects.toThrow("already exists");
    const snapshotAfter = treasury.getSnapshot();
    // Vault state, tranche list, balances, ledger, and audit log are all unchanged
    expect(snapshotAfter.audit).toHaveLength(snapshotBefore.audit.length);
    expect(snapshotAfter.incomingTranches.map((t) => t.id)).not.toContain("tranche:dup-eventid-other");
    expect(snapshotAfter.balances.confirmed).toEqual(snapshotBefore.balances.confirmed);
    expect(snapshotAfter.vault.totalCapital).toEqual(snapshotBefore.vault.totalCapital);
    expect(snapshotAfter.ledger).toHaveLength(snapshotBefore.ledger.length);
  });

  it("keeps tranche reconciliation idempotent and keeps vault totals aligned with ledger-derived balances", async () => {
    const { treasury } = setup();
    await treasury.recordIncomingTranche({
      trancheId: "tranche:reconcile",
      amount: usdc("250000000"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:reconcile:prepared",
      eventId: "audit:tranche:reconcile:prepared",
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:reconcile",
      amount: usdc("250000000"),
      transactionRef: { ...mockTransaction("SUBMITTED", "SETTLEMENT"), transactionHash: "mock:transaction:reconcile" },
      actor: authorizedSystem,
      idempotencyKey: "tranche:reconcile:submitted",
      eventId: "audit:tranche:reconcile:submitted",
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:reconcile",
      amount: usdc("250000000"),
      transactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: "mock:transaction:reconcile" },
      actor: authorizedSystem,
      idempotencyKey: "tranche:reconcile:confirmed",
      eventId: "audit:tranche:reconcile:confirmed",
      occurredAt: context.occurredAt,
    });
    const reconciled = await treasury.reconcileConfirmedTranche({ trancheId: "tranche:reconcile", actor: authorizedSystem, idempotencyKey: "reconcile:key", eventId: "audit:reconcile:key", occurredAt: context.occurredAt });
    const duplicate = await treasury.reconcileConfirmedTranche({ trancheId: "tranche:reconcile", actor: authorizedSystem, idempotencyKey: "reconcile:key", eventId: "audit:reconcile:key:duplicate", occurredAt: context.occurredAt });
    expect(reconciled).toEqual(duplicate);
    await expect(treasury.recordIncomingTranche({
      trancheId: reconciled.id,
      amount: reconciled.amount,
      transactionRef: reconciled.transactionRef,
      actor: authorizedSystem,
      idempotencyKey: "tranche:reconciled:terminal",
      eventId: "audit:tranche:reconciled:terminal",
      occurredAt: context.occurredAt,
    })).rejects.toThrow(/Reconciled tranches cannot be modified/);
    const snapshot = treasury.getSnapshot();
    expect(snapshot.vault.totalCapital.atomicUnits).toBe("1250000000");
    expect(snapshot.balances.confirmed.atomicUnits).toBe("1250000000");
    const invariant = treasury.getReconciliationInvariant();
    expect(invariant.isConsistent).toBe(true);
    expect(invariant.dashboard.totalCapital.atomicUnits).toBe(invariant.ledger.totalCapital.atomicUnits);
    expect(invariant.dashboard.available.atomicUnits).toBe(invariant.ledger.available.atomicUnits);
    expect(invariant.dashboard.unallocated.atomicUnits).toBe(invariant.ledger.unallocated.atomicUnits);
  });

  it("rejects live Arc incoming settlement evidence before any treasury mutation", async () => {
    const { treasury } = setup("ARC_TESTNET", authorizedAdapter);
    const liveByStatus = (status: "PREPARED" | "SUBMITTED" | "CONFIRMED" | "FAILED") => ArcTransactionRefSchema.parse({
      ...liveTransaction,
      status,
      transactionHash: status === "PREPARED" ? null : liveHash,
      blockNumber: status === "CONFIRMED" ? "1" : null,
      blockHash: status === "CONFIRMED" ? liveBlockHash : null,
      explorerUrl: status === "PREPARED" ? null : arcTestnetExplorerTransactionUrl(liveHash),
    });

    for (const status of ["PREPARED", "SUBMITTED", "CONFIRMED", "FAILED"] as const) {
      const before = treasury.getSnapshot();
      await expect(treasury.recordIncomingTranche({
        trancheId: `tranche:live-${status.toLowerCase()}`,
        amount: usdc("1"),
        transactionRef: liveByStatus(status),
        actor: authorizedAdapter,
        idempotencyKey: `tranche:live-${status.toLowerCase()}`,
        eventId: `audit:tranche:live-${status.toLowerCase()}`,
        occurredAt: context.occurredAt,
      })).rejects.toThrow(/Incoming tranche credit is not supported for ARC_TESTNET vaults/);
      expect(treasury.getSnapshot()).toEqual(before);
    }
  });

  it("rejects mock incoming settlement evidence for ARC_TESTNET vault before any treasury mutation", async () => {
    const { treasury } = setup("ARC_TESTNET", authorizedAdapter);
    for (const status of ["PREPARED", "SUBMITTED", "CONFIRMED"] as const) {
      const before = treasury.getSnapshot();
      await expect(treasury.recordIncomingTranche({
        trancheId: `tranche:arc-mock-${status.toLowerCase()}`,
        amount: usdc("1"),
        transactionRef: mockTransaction(status, "SETTLEMENT"),
        actor: authorizedAdapter,
        idempotencyKey: `tranche:arc-mock-${status.toLowerCase()}`,
        eventId: `audit:tranche:arc-mock-${status.toLowerCase()}`,
        occurredAt: context.occurredAt,
      })).rejects.toThrow(/Incoming tranche credit is not supported for ARC_TESTNET vaults/);
      const after = treasury.getSnapshot();
      expect(after.incomingTranches).toEqual(before.incomingTranches);
      expect(after.balances.confirmed.atomicUnits).toBe(before.balances.confirmed.atomicUnits);
      expect(after.vault.totalCapital.atomicUnits).toBe(before.vault.totalCapital.atomicUnits);
      expect(after.ledger).toEqual(before.ledger);
      expect(after.audit).toEqual(before.audit);
    }
  });

  it("serializes transaction-hash uniqueness: concurrent identical settlement hash allows only one tranche to become CONFIRMED", async () => {
    const { treasury } = setup();
    const sharedHash = "mock:transaction:shared-concurrent";
    // Establish tranche-a through PREPARED
    await treasury.recordIncomingTranche({
      trancheId: "tranche:concurrent-a",
      amount: usdc("10"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:concurrent-a:prepared",
      eventId: "audit:tranche:concurrent-a:prepared",
      occurredAt: context.occurredAt,
    });
    // Establish tranche-b through PREPARED
    await treasury.recordIncomingTranche({
      trancheId: "tranche:concurrent-b",
      amount: usdc("10"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:concurrent-b:prepared",
      eventId: "audit:tranche:concurrent-b:prepared",
      occurredAt: context.occurredAt,
    });
    const snapshotBeforeRace = treasury.getSnapshot();
    // Both tranches now race to claim the same SUBMITTED hash
    const [resultA, resultB] = await Promise.allSettled([
      treasury.recordIncomingTranche({
        trancheId: "tranche:concurrent-a",
        amount: usdc("10"),
        transactionRef: { ...mockTransaction("SUBMITTED", "SETTLEMENT"), transactionHash: sharedHash },
        actor: authorizedSystem,
        idempotencyKey: "tranche:concurrent-a:submitted",
        eventId: "audit:tranche:concurrent-a:submitted",
        occurredAt: context.occurredAt,
      }),
      treasury.recordIncomingTranche({
        trancheId: "tranche:concurrent-b",
        amount: usdc("10"),
        transactionRef: { ...mockTransaction("SUBMITTED", "SETTLEMENT"), transactionHash: sharedHash },
        actor: authorizedSystem,
        idempotencyKey: "tranche:concurrent-b:submitted",
        eventId: "audit:tranche:concurrent-b:submitted",
        occurredAt: context.occurredAt,
      }),
    ]);
    // Exactly one must succeed and one must be rejected
    const fulfilled = [resultA, resultB].filter((r) => r.status === "fulfilled");
    const rejected = [resultA, resultB].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/already bound to another tranche/);
    // Exactly one tranche holds the shared hash; the other is still PREPARED
    const snapshot = treasury.getSnapshot();
    const withHash = snapshot.incomingTranches.filter((t) => t.transactionRef.transactionHash === sharedHash);
    expect(withHash).toHaveLength(1);
    const withoutHash = snapshot.incomingTranches.filter((t) => ["tranche:concurrent-a", "tranche:concurrent-b"].includes(t.id) && t.transactionRef.transactionHash === null);
    expect(withoutHash).toHaveLength(1);
    // Financial state is unchanged from before the race (no credit has been confirmed)
    expect(snapshot.balances.confirmed.atomicUnits).toBe(snapshotBeforeRace.balances.confirmed.atomicUnits);
    expect(snapshot.vault.totalCapital.atomicUnits).toBe(snapshotBeforeRace.vault.totalCapital.atomicUnits);
  });

  it("serializes transaction-hash uniqueness: accepted tranche can reconcile once; rejected call leaves no side effects", async () => {
    const { treasury } = setup();
    const sharedHash = "mock:transaction:reconcile-race";
    // Establish two tranches through PREPARED
    for (const id of ["tranche:race-a", "tranche:race-b"]) {
      await treasury.recordIncomingTranche({
        trancheId: id,
        amount: usdc("5"),
        transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
        actor: authorizedSystem,
        idempotencyKey: `${id}:prepared`,
        eventId: `audit:${id}:prepared`,
        occurredAt: context.occurredAt,
      });
    }
    // Race for CONFIRMED with the same hash
    const [resultA, resultB] = await Promise.allSettled([
      treasury.recordIncomingTranche({
        trancheId: "tranche:race-a",
        amount: usdc("5"),
        transactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: sharedHash },
        actor: authorizedSystem,
        idempotencyKey: "tranche:race-a:confirmed",
        eventId: "audit:tranche:race-a:confirmed",
        occurredAt: context.occurredAt,
      }),
      treasury.recordIncomingTranche({
        trancheId: "tranche:race-b",
        amount: usdc("5"),
        transactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: sharedHash },
        actor: authorizedSystem,
        idempotencyKey: "tranche:race-b:confirmed",
        eventId: "audit:tranche:race-b:confirmed",
        occurredAt: context.occurredAt,
      }),
    ]);
    const fulfilled = [resultA, resultB].filter((r) => r.status === "fulfilled");
    const rejected = [resultA, resultB].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const winnerTranche = (fulfilled[0] as PromiseFulfilledResult<import("../src/treasury").IncomingTranche>).value;
    const loserId = winnerTranche.id === "tranche:race-a" ? "tranche:race-b" : "tranche:race-a";
    // The winner can reconcile
    const snapshotBeforeReconcile = treasury.getSnapshot();
    await expect(treasury.reconcileConfirmedTranche({
      trancheId: winnerTranche.id,
      actor: authorizedSystem,
      idempotencyKey: `reconcile:${winnerTranche.id}`,
      eventId: `audit:reconcile:${winnerTranche.id}`,
      occurredAt: context.occurredAt,
    })).resolves.toBeDefined();
    // The loser remains PREPARED and cannot be reconciled
    const snapshot = treasury.getSnapshot();
    const loser = snapshot.incomingTranches.find((t) => t.id === loserId);
    expect(loser?.state).toBe("PREPARED");
    await expect(treasury.reconcileConfirmedTranche({
      trancheId: loserId,
      actor: authorizedSystem,
      idempotencyKey: `reconcile:${loserId}`,
      eventId: `audit:reconcile:${loserId}`,
      occurredAt: context.occurredAt,
    })).rejects.toThrow();
    // Exactly one tranche was credited — no duplicate settlement
    expect(snapshot.balances.confirmed.atomicUnits).not.toBe(snapshotBeforeReconcile.balances.confirmed.atomicUnits);
    const additionalReconcile = treasury.getSnapshot();
    expect(additionalReconcile.balances.confirmed.atomicUnits).toBe(snapshot.balances.confirmed.atomicUnits);
    // Audit log contains no duplicate entries for the loser's CONFIRMED state
    const loserConfirmedEvents = snapshot.audit.filter((e) => e.aggregateId === loserId && e.details.nextState === "CONFIRMED");
    expect(loserConfirmedEvents).toHaveLength(0);
  });

  it("records append-only audit history with actor, state transition, timestamp, and related IDs", async () => {
    const { treasury } = setup();
    const proposal = treasury.createAllocationProposal({
      proposalId: "proposal:audit",
      instructions: [{ reserveId: "reserve:contingency", kind: "FIXED", atomicUnits: "100000000" }],
      actor: founder,
      eventId: "audit:proposal:audit",
      occurredAt: context.occurredAt,
    });
    const approval = await buildApproval(proposal);
    await treasury.approveAllocationProposal({ proposalId: proposal.id, approval, actor: founder, eventId: "audit:approval:audit", occurredAt: context.occurredAt });
    await treasury.applyApprovedProposal({ proposalId: proposal.id, actor: authorizedSystem, idempotencyKey: "apply:audit:key", eventId: "audit:apply:audit", occurredAt: context.occurredAt });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:audit",
      amount: usdc("1"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: "tranche:audit:prepared",
      eventId: "audit:tranche:audit:prepared",
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:audit",
      amount: usdc("1"),
      transactionRef: { ...mockTransaction("SUBMITTED", "SETTLEMENT"), transactionHash: "mock:transaction:audit" },
      actor: authorizedSystem,
      idempotencyKey: "tranche:audit:submitted",
      eventId: "audit:tranche:audit:submitted",
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId: "tranche:audit",
      amount: usdc("1"),
      transactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: "mock:transaction:audit" },
      actor: authorizedSystem,
      idempotencyKey: "tranche:audit:confirmed",
      eventId: "audit:tranche:audit:confirmed",
      occurredAt: context.occurredAt,
    });
    await treasury.reconcileConfirmedTranche({ trancheId: "tranche:audit", actor: authorizedSystem, idempotencyKey: "reconcile:audit:key", eventId: "audit:reconcile:audit", occurredAt: context.occurredAt });
    const audit = treasury.getSnapshot().audit;
    const transitions = audit.filter((entry) => typeof entry.details.nextState === "string" && ["PROPOSED", "APPROVED", "APPLIED", "CONFIRMED", "RECONCILED"].includes(entry.details.nextState));
    expect(transitions.length).toBeGreaterThanOrEqual(5);
    transitions.forEach((entry) => {
      expect(entry.actor.actorId.length).toBeGreaterThan(0);
      expect(entry.details.previousState).toBeTruthy();
      expect(entry.details.nextState).toBeTruthy();
      expect(entry.occurredAt).toBe(context.occurredAt);
      expect(typeof entry.details.proposalId === "string" || entry.details.proposalId === null).toBe(true);
      expect(typeof entry.details.trancheId === "string" || entry.details.trancheId === null).toBe(true);
    });
    expect("update" in audit).toBe(false);
    expect("delete" in audit).toBe(false);
  });

  it("rejects a concurrent recordIncomingTranche for a CONFIRMED tranche that has been RECONCILED in the same tick", async () => {
    // Scenario: one CONFIRMED tranche; reconciliation and a same-state CONFIRMED record run concurrently.
    // Only the reconciliation should succeed. The record attempt must be rejected without mutating state.
    const { treasury } = setup();
    const sharedHash = "mock:transaction:reconcile-record-race";
    const trancheId = "tranche:reconcile-record-race";

    // Seed a CONFIRMED tranche
    await treasury.recordIncomingTranche({
      trancheId,
      amount: usdc("1"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: `${trancheId}:prepared`,
      eventId: `audit:${trancheId}:prepared`,
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId,
      amount: usdc("1"),
      transactionRef: { ...mockTransaction("SUBMITTED", "SETTLEMENT"), transactionHash: sharedHash },
      actor: authorizedSystem,
      idempotencyKey: `${trancheId}:submitted`,
      eventId: `audit:${trancheId}:submitted`,
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId,
      amount: usdc("1"),
      transactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: sharedHash },
      actor: authorizedSystem,
      idempotencyKey: `${trancheId}:confirmed`,
      eventId: `audit:${trancheId}:confirmed`,
      occurredAt: context.occurredAt,
    });

    const snapshotBefore = treasury.getSnapshot();

    // Launch reconciliation and a duplicate CONFIRMED record concurrently with different idempotency keys
    const [reconcileResult, recordResult] = await Promise.allSettled([
      treasury.reconcileConfirmedTranche({
        trancheId,
        actor: authorizedSystem,
        idempotencyKey: `reconcile:${trancheId}`,
        eventId: `audit:reconcile:${trancheId}`,
        occurredAt: context.occurredAt,
      }),
      treasury.recordIncomingTranche({
        trancheId,
        amount: usdc("1"),
        transactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: sharedHash },
        actor: authorizedSystem,
        idempotencyKey: `${trancheId}:confirmed-retry`,
        eventId: `audit:${trancheId}:confirmed-retry`,
        occurredAt: context.occurredAt,
      }),
    ]);

    const snapshotAfter = treasury.getSnapshot();
    const reconciledTranche = snapshotAfter.incomingTranches.find((t) => t.id === trancheId);

    // Reconcile must have succeeded (it is scheduled first and wins the microtask race).
    // The record attempt must have been rejected by the callback-local RECONCILED guard.
    expect(reconcileResult.status).toBe("fulfilled");
    expect(recordResult.status).toBe("rejected");

    // The tranche must end up in RECONCILED state
    expect(reconciledTranche?.state).toBe("RECONCILED");

    // Confirmed balance must be credited exactly once
    const confirmedAfter = BigInt(snapshotAfter.balances.confirmed.atomicUnits);
    const confirmedBefore = BigInt(snapshotBefore.balances.confirmed.atomicUnits);
    const trancheAmount = BigInt(usdc("1").atomicUnits);
    expect(confirmedAfter - confirmedBefore).toBe(trancheAmount);

    // A second reconcile attempt must fail (no duplicate credit)
    await expect(treasury.reconcileConfirmedTranche({
      trancheId,
      actor: authorizedSystem,
      idempotencyKey: `reconcile:${trancheId}:second`,
      eventId: `audit:reconcile:${trancheId}:second`,
      occurredAt: context.occurredAt,
    })).rejects.toThrow();

    const snapshotFinal = treasury.getSnapshot();
    expect(snapshotFinal.balances.confirmed.atomicUnits).toBe(snapshotAfter.balances.confirmed.atomicUnits);
  });

  it("preserves all invariants when a recordIncomingTranche is rejected due to stale RECONCILED state", async () => {
    // Scenario: reconcile a tranche fully, then attempt to record it again with a new key.
    // The callback re-read must detect RECONCILED state and reject without side effects.
    const { treasury } = setup();
    const trancheId = "tranche:stale-reconciled";
    const txHash = "mock:transaction:stale-reconciled";

    await treasury.recordIncomingTranche({
      trancheId,
      amount: usdc("2"),
      transactionRef: mockTransaction("PREPARED", "SETTLEMENT"),
      actor: authorizedSystem,
      idempotencyKey: `${trancheId}:prepared`,
      eventId: `audit:${trancheId}:prepared`,
      occurredAt: context.occurredAt,
    });
    await treasury.recordIncomingTranche({
      trancheId,
      amount: usdc("2"),
      transactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: txHash },
      actor: authorizedSystem,
      idempotencyKey: `${trancheId}:confirmed`,
      eventId: `audit:${trancheId}:confirmed`,
      occurredAt: context.occurredAt,
    });
    await treasury.reconcileConfirmedTranche({
      trancheId,
      actor: authorizedSystem,
      idempotencyKey: `reconcile:${trancheId}`,
      eventId: `audit:reconcile:${trancheId}`,
      occurredAt: context.occurredAt,
    });

    const snapshotAfterReconcile = treasury.getSnapshot();

    // Attempt a new record with a fresh idempotency key against the now-RECONCILED tranche
    await expect(treasury.recordIncomingTranche({
      trancheId,
      amount: usdc("2"),
      transactionRef: { ...mockTransaction("CONFIRMED", "SETTLEMENT"), transactionHash: txHash },
      actor: authorizedSystem,
      idempotencyKey: `${trancheId}:confirmed-late`,
      eventId: `audit:${trancheId}:confirmed-late`,
      occurredAt: context.occurredAt,
    })).rejects.toThrow();

    const snapshotFinal = treasury.getSnapshot();
    // State, balances, vault, ledger, and audit log must all be unchanged
    expect(snapshotFinal.incomingTranches.find((t) => t.id === trancheId)?.state).toBe("RECONCILED");
    expect(snapshotFinal.balances.confirmed.atomicUnits).toBe(snapshotAfterReconcile.balances.confirmed.atomicUnits);
    expect(snapshotFinal.vault.totalCapital.atomicUnits).toBe(snapshotAfterReconcile.vault.totalCapital.atomicUnits);
    expect(snapshotFinal.ledger).toHaveLength(snapshotAfterReconcile.ledger.length);
    expect(snapshotFinal.audit).toHaveLength(snapshotAfterReconcile.audit.length);
  });

  it("rejects initialization when initializingActor does not match either configured authority", async () => {
    const seed = createPawPovAiSeed();
    const reserves = seed.reserves.map((reserve) => ReserveSchema.parse({ ...reserve, allocated: usdc("0"), status: "PROPOSED" }));
    const executionAuthority = authorizedSystem;
    const founderAuthority = founder;

    // AI actor with explicit valid authorities must be rejected
    expect(() => new LaunchVaultTreasury({
      vault: seed.vault, reserves,
      actor: { actorId: "ai:agent", actorType: "AI" },
      executionAuthority,
      founderAuthority,
    })).toThrow(TreasuryError);

    // BACKER actor must be rejected
    expect(() => new LaunchVaultTreasury({
      vault: seed.vault, reserves,
      actor: { actorId: "backer:1", actorType: "BACKER" },
      executionAuthority,
      founderAuthority,
    })).toThrow(TreasuryError);

    // Unrelated FOUNDER actor (not the configured founderAuthority) must be rejected
    expect(() => new LaunchVaultTreasury({
      vault: seed.vault, reserves,
      actor: { actorId: "founder:unrelated", actorType: "FOUNDER" },
      executionAuthority,
      founderAuthority,
    })).toThrow(TreasuryError);

    // Unrelated SYSTEM actor (not the configured executionAuthority) must be rejected
    expect(() => new LaunchVaultTreasury({
      vault: seed.vault, reserves,
      actor: unauthorizedSystem,
      executionAuthority,
      founderAuthority,
    })).toThrow(TreasuryError);

    // Exact configured execution authority (SYSTEM) must succeed
    expect(() => new LaunchVaultTreasury({
      vault: seed.vault, reserves,
      actor: executionAuthority,
      executionAuthority,
      founderAuthority,
    })).not.toThrow();

    // Exact configured founder authority must succeed when execution authority is separately supplied
    expect(() => new LaunchVaultTreasury({
      vault: seed.vault, reserves,
      actor: founder,
      executionAuthority,
      founderAuthority,
    })).not.toThrow();
  });

  it("preserves Arc Testnet zero-capital adapter initialization and rejects unauthorized actors", async () => {
    const seed = createPawPovAiSeed();
    const reserves = seed.reserves.map((reserve) => ReserveSchema.parse({ ...reserve, allocated: usdc("0"), status: "PROPOSED" }));
    const liveVault = LaunchVaultSchema.parse({ ...seed.vault, mode: "ARC_TESTNET", totalCapital: usdc("0") });

    // Exact authorized adapter must succeed for ARC_TESTNET
    expect(() => new LaunchVaultTreasury({
      vault: liveVault, reserves,
      actor: authorizedAdapter,
      executionAuthority: authorizedAdapter,
      founderAuthority: founder,
    })).not.toThrow();

    // AI actor with valid explicit ADAPTER authority must be rejected
    expect(() => new LaunchVaultTreasury({
      vault: liveVault, reserves,
      actor: { actorId: "ai:agent", actorType: "AI" },
      executionAuthority: authorizedAdapter,
      founderAuthority: founder,
    })).toThrow(TreasuryError);

    // Unrelated ADAPTER actor must be rejected
    expect(() => new LaunchVaultTreasury({
      vault: liveVault, reserves,
      actor: unauthorizedAdapter,
      executionAuthority: authorizedAdapter,
      founderAuthority: founder,
    })).toThrow(TreasuryError);
  });
});
