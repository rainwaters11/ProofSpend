import { describe, expect, it } from "vitest";
import {
  addMoney, AgenticJobRefSchema, AgenticJobStatusSchema, AgentIdentityRefSchema, AgentReputationRefSchema,
  ARC_TESTNET_CHAIN_ID, arcTestnetExplorerTransactionUrl,
  AllocationOperationRecordSchema, AllocationRuleSchema, ApprovalRecordSchema, ArcTransactionRefSchema, CanonicalExecutionIntentSchema, compareMoney,
  createPawPovAiSeed, EvidenceItemSchema, ExecutionAuthorizationBindingSchema, filterBackerDisclosure, IdempotencyConflictError, JobEvaluationEvidenceSchema, InMemoryAuditRepository,
  ExecutionAuthorizationBindingRepository, InMemoryIdempotencyRepository, InMemoryRepository, InvalidTransitionError, LaunchVaultSchema, mapAgenticJobToApplication,
  LedgerEntrySchema, MilestoneRequirementSchema, MilestoneSchema, type ArcTransactionRef, type LedgerEntry,
  MockAgenticJobAdapter, MockIdentityAdapter, MockWalletReferenceAdapter, money, MoneyAmountSchema, MoneyError,
  RecoveryOperationRecordSchema, ReleaseRequestSchema, ReserveSchema, SettlementMoneyAmountSchema, SettlementRecordSchema, SubmissionOperationRecordSchema, subtractMoney,
  ReconciliationRecordSchema, TransactionRecordSchema, transitionAgenticJob, transitionApplication, transitionApplicationSubmission,
  hashCanonicalExecutionIntent, serializeCanonicalExecutionIntent, validateExecutionAuthorization, validateLedgerReversal, validateReconciliation, validateReleaseConfirmation,
} from "../src";

type ReversalEntry = Extract<LedgerEntry, { kind: "REVERSAL" }>;

const context = { aggregateType: "milestone", aggregateId: "m1", eventId: "event:1", occurredAt: "2026-01-01T00:00:00.000Z", actor: { actorId: "system", actorType: "SYSTEM" as const } };
const usdc = (atomicUnits: string) => SettlementMoneyAmountSchema.parse({ asset: "USDC", atomicUnits });
const mockTransaction = (status: "NONE" | "PREPARED" | "SUBMITTED" | "CONFIRMED" | "FAILED", operationType: "SETTLEMENT" | "REFUND" | "JOB_FUND" | "JOB_SUBMIT" | "JOB_EVALUATE" = "SETTLEMENT") => ({
  network: "ARC_TESTNET" as const, chainId: "synthetic:chain", transactionHash: status === "SUBMITTED" || status === "CONFIRMED" ? "mock:transaction" : null,
  status, blockNumber: status === "CONFIRMED" ? "1" : null, blockHash: status === "CONFIRMED" ? "mock:block" : null,
  explorerUrl: null, operationType, isMock: true,
});
const mockJob = (status: "OPEN" | "FUNDED" | "SUBMITTED" | "COMPLETED" | "REJECTED" | "EXPIRED", transaction: ArcTransactionRef | null = null) => AgenticJobRefSchema.parse({ standard: "ERC-8183", network: "mock:network", chainId: "mock:chain", contractAddress: "mock:contract", jobId: "mock:job", clientAddress: "mock:client", providerAddress: "mock:provider", evaluatorAddress: "mock:evaluator", budget: usdc("1"), expiresAt: "2026-01-01T00:00:00.000Z", descriptionReference: "mock:description", deliverableReference: ["SUBMITTED", "COMPLETED", "REJECTED"].includes(status) ? "mock:deliverable" : null, reasonReference: status === "REJECTED" ? "mock:reason" : null, status, transaction, isMock: true });
const providerSubmissionAuthorization = async (job: ReturnType<typeof mockJob>, transactionId = "transaction:job-submit") => {
  if (job.transaction === null) throw new Error("Provider submission authorization requires transaction evidence.");
  const intentId = "intent:job-submit";
  const approvalId = "approval:job-submit";
  const bindingId = "binding:job-submit";
  const projectId = "project:job";
  const executionIntent = CanonicalExecutionIntentSchema.parse({
    version: 1, actionKind: "JOB_SUBMISSION", projectId, releaseRequestId: job.jobId, transactionRecordId: transactionId, intentId,
    asset: job.budget.asset, atomicAmount: job.budget.atomicUnits, operationType: "JOB_SUBMIT",
    protocolTarget: { kind: "ERC8183", standard: "ERC-8183", network: job.transaction.network, chainId: job.transaction.chainId, contractReference: job.contractAddress, jobId: job.jobId, method: "JOB_SUBMIT", parameterCommitment: `sha256:${"c".repeat(64)}`, clientReference: job.clientAddress, providerReference: job.providerAddress, evaluatorReference: job.evaluatorAddress, destination: job.contractAddress },
  });
  const exactIntentHash = await hashCanonicalExecutionIntent(executionIntent);
  const jobApprovalDecision = ApprovalRecordSchema.parse({ id: approvalId, aggregateId: job.jobId, intentId, actionKind: "JOB_SUBMISSION", authorizedActorType: "PROVIDER", authorizedActorId: job.providerAddress, exactIntentHash, idempotencyKey: "approval:job-submit:key", decision: "APPROVED", approver: { actorId: job.providerAddress, actorType: "PROVIDER" }, expiresAt: "2027-01-01T00:00:00.000Z", decidedAt: context.occurredAt });
  const executionBinding = ExecutionAuthorizationBindingSchema.parse({ id: bindingId, releaseRequestId: job.jobId, approvalId, intentId, exactIntentHash, transactionRecordId: transactionId, executionIntent, status: "CONSUMED", consumedAt: context.occurredAt, consumedByTransactionId: transactionId, createdAt: context.occurredAt });
  return { authorizedProviderId: job.providerAddress, jobApprovalDecision, executionBinding, expectedProjectId: projectId, expectedReleaseRequestId: job.jobId, expectedTransactionId: transactionId, expectedIntentId: intentId, expectedApprovalId: approvalId, expectedApprovalBindingId: bindingId, expectedExactIntentHash: exactIntentHash };
};
const jobEvaluationAuthorization = async (job: ReturnType<typeof mockJob>, decision: "APPROVED" | "REJECTED", transactionId = `transaction:job-evaluate:${decision.toLowerCase()}`) => {
  if (job.transaction === null) throw new Error("Job evaluation authorization requires transaction evidence.");
  const intentId = `intent:job-evaluate:${decision.toLowerCase()}`;
  const approvalId = `approval:${decision}`;
  const bindingId = `binding:job-evaluate:${decision.toLowerCase()}`;
  const projectId = "project:job";
  const executionIntent = CanonicalExecutionIntentSchema.parse({
    version: 1, actionKind: "JOB_EVALUATION", projectId, releaseRequestId: job.jobId, transactionRecordId: transactionId, intentId,
    asset: job.budget.asset, atomicAmount: job.budget.atomicUnits, operationType: "JOB_EVALUATE",
    protocolTarget: { kind: "ERC8183", standard: "ERC-8183", network: job.transaction.network, chainId: job.transaction.chainId, contractReference: job.contractAddress, jobId: job.jobId, method: "JOB_EVALUATE", parameterCommitment: `sha256:${"f".repeat(64)}`, clientReference: job.clientAddress, providerReference: job.providerAddress, evaluatorReference: job.evaluatorAddress, destination: job.contractAddress },
  });
  const exactIntentHash = await hashCanonicalExecutionIntent(executionIntent);
  const jobApprovalDecision = ApprovalRecordSchema.parse({ id: approvalId, aggregateId: job.jobId, intentId, actionKind: "JOB_EVALUATION", authorizedActorType: "EVALUATOR", authorizedActorId: job.evaluatorAddress, exactIntentHash, idempotencyKey: `approval:${decision}:key`, decision, approver: { actorId: job.evaluatorAddress, actorType: "EVALUATOR" }, expiresAt: "2027-01-01T00:00:00.000Z", decidedAt: context.occurredAt });
  const executionBinding = ExecutionAuthorizationBindingSchema.parse({ id: bindingId, releaseRequestId: job.jobId, approvalId, intentId, exactIntentHash, transactionRecordId: transactionId, executionIntent, status: "CONSUMED", consumedAt: context.occurredAt, consumedByTransactionId: transactionId, createdAt: context.occurredAt });
  const jobEvaluationEvidence = JobEvaluationEvidenceSchema.parse({ id: `evaluation:${decision}`, jobId: job.jobId, approvalId, intentId, exactIntentHash, decision, transactionHash: job.transaction.transactionHash, transactionNetwork: job.transaction.network, transactionChainId: job.transaction.chainId });
  return { authorizedEvaluatorId: job.evaluatorAddress, jobApprovalDecision, executionBinding, jobEvaluationEvidence, expectedProjectId: projectId, expectedReleaseRequestId: job.jobId, expectedTransactionId: transactionId, expectedIntentId: intentId, expectedApprovalId: approvalId, expectedApprovalBindingId: bindingId, expectedExactIntentHash: exactIntentHash };
};
const liveHash = `0x${"a".repeat(64)}`;
const liveBlockHash = `0x${"b".repeat(64)}`;
const liveTransaction = { network: "ARC_TESTNET" as const, chainId: ARC_TESTNET_CHAIN_ID, transactionHash: liveHash, status: "CONFIRMED" as const, blockNumber: "1", blockHash: liveBlockHash, explorerUrl: arcTestnetExplorerTransactionUrl(liveHash), operationType: "SETTLEMENT" as const, isMock: false };

describe("atomic money", () => {
  it.each(["1.0", "01", "-1", "1e6", " 1", ""])("rejects non-canonical atomic units %j", (atomicUnits: string) => {
    expect(() => MoneyAmountSchema.parse({ asset: "USDC", atomicUnits })).toThrow();
  });
  it("uses exact bigint arithmetic without number inputs", () => {
    expect(addMoney(money("USDC", "9007199254740993"), money("USDC", "7"))).toEqual(money("USDC", "9007199254741000"));
    expect(subtractMoney(money("USDC", "10"), money("USDC", "4"))).toEqual(money("USDC", "6"));
    expect(compareMoney(money("USDC", "4"), money("USDC", "5"))).toBe(-1);
  });
  it("rejects asset mismatch and underflow", () => {
    expect(() => addMoney(money("USDC", "1"), money("EURC", "1"))).toThrow(MoneyError);
    expect(() => subtractMoney(money("USDC", "1"), money("USDC", "2"))).toThrow(MoneyError);
  });
  it("revalidates hydrated operands before arithmetic", () => {
    const negative = { asset: "USDC", atomicUnits: "-1" } as ReturnType<typeof money>;
    expect(() => addMoney(negative, money("USDC", "1"))).toThrow();
    expect(() => subtractMoney(money("USDC", "1"), negative)).toThrow();
    expect(() => compareMoney(negative, money("USDC", "1"))).toThrow();
  });
});

describe("separate state machines", () => {
  it("exposes exactly the required ERC-8183 statuses", () => {
    expect(AgenticJobStatusSchema.options).toEqual(["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"]);
  });
  it("emits an audit event for a successful application transition", () => {
    expect(transitionApplication("NEEDS_REVIEW", "ELIGIBLE", { ...context, authorizedSystemId: "system" })).toMatchObject({ state: "ELIGIBLE", auditEvent: { eventType: "STATE_TRANSITIONED", details: { from: "NEEDS_REVIEW", to: "ELIGIBLE" } } });
  });
  it("does not mutate state or emit an event for an invalid transition", () => {
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
  });
  it.each(["AI", "SYSTEM", "BACKER", "PROVIDER", "ADAPTER"] as const)("rejects %s approval without emitting a successful result", (actorType: "AI" | "SYSTEM" | "BACKER" | "PROVIDER" | "ADAPTER") => {
    expect(() => transitionApplication("APPROVAL_PENDING", "APPROVED", { ...context, actor: { actorId: "forbidden", actorType }, authorizedApproverId: "forbidden" })).toThrow(InvalidTransitionError);
  });
  it("requires persisted approval and exact canonical intent evidence to submit", async () => {
    const transaction = TransactionRecordSchema.parse({ id: "transaction:submission", projectId: "project:1", releaseRequestId: "release:1", intentId: "intent:1", destinationReference: "mock:recipient", approvalId: "approval:1", approvalBindingId: "binding:submission", reconciliationId: null, idempotencyKey: "transaction:key", amount: usdc("1"), operationState: "SUBMITTED", arcTransaction: mockTransaction("SUBMITTED"), createdAt: context.occurredAt, updatedAt: context.occurredAt });
    const executionIntent = CanonicalExecutionIntentSchema.parse({ version: 1, actionKind: "RELEASE_APPROVAL", projectId: transaction.projectId, releaseRequestId: transaction.releaseRequestId, transactionRecordId: transaction.id, intentId: transaction.intentId, asset: "USDC", atomicAmount: "1", operationType: "SETTLEMENT", protocolTarget: { kind: "DESTINATION", destination: transaction.destinationReference, network: "ARC_TESTNET", chainId: "synthetic:chain" } });
    for (const protocolTarget of [
      { ...executionIntent.protocolTarget, network: null },
      { ...executionIntent.protocolTarget, chainId: null },
      { ...executionIntent.protocolTarget, network: "OTHER_NETWORK" },
      { ...executionIntent.protocolTarget, destination: "not-an-address" },
    ]) expect(CanonicalExecutionIntentSchema.safeParse({ ...executionIntent, protocolTarget }).success).toBe(false);
    const exactIntentHash = await hashCanonicalExecutionIntent(executionIntent);
    const approvalDecision = ApprovalRecordSchema.parse({ id: transaction.approvalId, aggregateId: transaction.releaseRequestId, intentId: transaction.intentId, actionKind: "RELEASE_APPROVAL", authorizedActorType: "FOUNDER", authorizedActorId: "founder:1", exactIntentHash, idempotencyKey: "approval:key", decision: "APPROVED", approver: { actorId: "founder:1", actorType: "FOUNDER" }, expiresAt: "2027-01-01T00:00:00.000Z", decidedAt: context.occurredAt });
    const binding = ExecutionAuthorizationBindingSchema.parse({ id: transaction.approvalBindingId, releaseRequestId: transaction.releaseRequestId, approvalId: transaction.approvalId, intentId: transaction.intentId, exactIntentHash, transactionRecordId: transaction.id, executionIntent, status: "CONSUMED", consumedAt: context.occurredAt, consumedByTransactionId: transaction.id, createdAt: context.occurredAt });
    const submissionOperation = SubmissionOperationRecordSchema.parse({ id: "submission:1", transactionId: transaction.id, idempotencyKey: "submission:key", createdAt: context.occurredAt });
    const submitted = { ...context, aggregateId: transaction.releaseRequestId, actor: { actorId: "adapter:authorized", actorType: "ADAPTER" as const }, authorizedAdapterId: "adapter:authorized", idempotencyKey: submissionOperation.idempotencyKey, submissionTransaction: transaction, executionBinding: binding, approvalDecision, submissionOperation, expectedTransactionId: transaction.id, expectedProjectId: transaction.projectId, expectedReleaseRequestId: transaction.releaseRequestId, expectedIntentId: transaction.intentId, expectedApprovalId: transaction.approvalId!, expectedApprovalBindingId: transaction.approvalBindingId! };
    await expect(transitionApplicationSubmission({ ...submitted, submissionTransaction: undefined })).rejects.toThrow(InvalidTransitionError);
    expect(() => transitionApplication("PREPARED", "SUBMITTED", submitted)).toThrow(InvalidTransitionError);
    for (const status of ["PREPARED", "CONFIRMED", "FAILED"] as const) await expect(transitionApplicationSubmission({ ...submitted, submissionTransaction: { ...transaction, operationState: status, arcTransaction: mockTransaction(status) } })).rejects.toThrow(InvalidTransitionError);
    for (const status of ["ACTIVE", "REVOKED"] as const) await expect(transitionApplicationSubmission({ ...submitted, executionBinding: { ...binding, status, consumedAt: null, consumedByTransactionId: null } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, executionBinding: { ...binding, consumedByTransactionId: "transaction:other" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, submissionOperation: undefined })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, idempotencyKey: "submission:other" })).rejects.toThrow(InvalidTransitionError);
    for (const changed of [{ projectId: "project:other" }, { releaseRequestId: "release:other" }, { intentId: "intent:other" }, { approvalId: "approval:other" }, { approvalBindingId: "binding:other" }]) await expect(transitionApplicationSubmission({ ...submitted, submissionTransaction: { ...transaction, ...changed } })).rejects.toThrow(InvalidTransitionError);
    for (const changed of [{ amount: usdc("2") }, { destinationReference: "mock:other" }, { arcTransaction: { ...transaction.arcTransaction!, operationType: "REFUND" as const } }, { arcTransaction: { ...transaction.arcTransaction!, chainId: "synthetic:other-chain" } }]) await expect(transitionApplicationSubmission({ ...submitted, submissionTransaction: { ...transaction, ...changed } })).rejects.toThrow(InvalidTransitionError);
    expect(() => TransactionRecordSchema.parse({ ...transaction, amount: money("EURC", "1") })).toThrow();
    await expect(transitionApplicationSubmission({ ...submitted, submissionTransaction: { ...transaction, arcTransaction: { ...transaction.arcTransaction!, network: "OTHER_NETWORK" } } as unknown as typeof transaction })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, approvalDecision: { ...approvalDecision, decision: "REJECTED" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, approvalDecision: { ...approvalDecision, exactIntentHash: `sha256:${"b".repeat(64)}` } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, executionBinding: { ...binding, exactIntentHash: `sha256:${"b".repeat(64)}` } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission(submitted)).resolves.toMatchObject({ state: "SUBMITTED" });
    type SubmissionOperationType = NonNullable<typeof transaction.arcTransaction>["operationType"];
    const erc8183Target = (method: "JOB_FUND" | "JOB_SUBMIT" | "JOB_EVALUATE") => ({ kind: "ERC8183" as const, standard: "ERC-8183" as const, network: "ARC_TESTNET" as const, chainId: "synthetic:chain", contractReference: "mock:contract", jobId: "mock:job", method, parameterCommitment: `sha256:${"c".repeat(64)}`, clientReference: "mock:client", providerReference: "mock:provider", evaluatorReference: "mock:evaluator", destination: transaction.destinationReference });
    const submitForOperation = async (operationType: SubmissionOperationType, actorType: "FOUNDER" | "PROVIDER" | "EVALUATOR") => {
      const actionKind = actorType === "FOUNDER" ? "RELEASE_APPROVAL" : actorType === "PROVIDER" ? "JOB_SUBMISSION" : "JOB_EVALUATION";
      const protocolTarget = operationType === "JOB_FUND" || operationType === "JOB_SUBMIT" || operationType === "JOB_EVALUATE" ? erc8183Target(operationType) : { kind: "DESTINATION" as const, destination: transaction.destinationReference, network: "ARC_TESTNET" as const, chainId: "synthetic:chain" };
      const candidateTransaction = TransactionRecordSchema.parse({ ...transaction, arcTransaction: { ...transaction.arcTransaction!, operationType } });
      const candidateIntent = CanonicalExecutionIntentSchema.parse({ ...executionIntent, actionKind, operationType, protocolTarget });
      const candidateHash = await hashCanonicalExecutionIntent(candidateIntent);
      const actorId = actorType === "FOUNDER" ? "founder:1" : actorType === "PROVIDER" ? "mock:provider" : "evaluator:1";
      const candidateApproval = ApprovalRecordSchema.parse({ ...approvalDecision, actionKind, authorizedActorType: actorType, authorizedActorId: actorId, approver: { actorId, actorType }, exactIntentHash: candidateHash });
      const candidateBinding = ExecutionAuthorizationBindingSchema.parse({ ...binding, exactIntentHash: candidateHash, executionIntent: candidateIntent });
      return transitionApplicationSubmission({ ...submitted, submissionTransaction: candidateTransaction, executionBinding: candidateBinding, approvalDecision: candidateApproval });
    };
    await expect(submitForOperation("SETTLEMENT", "FOUNDER")).resolves.toMatchObject({ state: "SUBMITTED" });
    await expect(submitForOperation("REFUND", "FOUNDER")).resolves.toMatchObject({ state: "SUBMITTED" });
    await expect(submitForOperation("JOB_FUND", "FOUNDER")).resolves.toMatchObject({ state: "SUBMITTED" });
    await expect(submitForOperation("JOB_SUBMIT", "PROVIDER")).resolves.toMatchObject({ state: "SUBMITTED" });
    await expect(submitForOperation("JOB_EVALUATE", "EVALUATOR")).resolves.toMatchObject({ state: "SUBMITTED" });
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
      const protocolTarget = { kind: "DESTINATION" as const, destination: transaction.destinationReference, network: "ARC_TESTNET" as const, chainId: "synthetic:chain" };
      for (const actionKind of ["RELEASE_APPROVAL", "JOB_SUBMISSION", "JOB_EVALUATION"] as const) expect(CanonicalExecutionIntentSchema.safeParse({ ...executionIntent, actionKind, operationType, protocolTarget }).success).toBe(false);
      const rawUnsupportedIntent = { ...executionIntent, actionKind: "RELEASE_APPROVAL" as const, operationType, protocolTarget };
      const unsupportedTransaction = TransactionRecordSchema.parse({ ...transaction, arcTransaction: { ...transaction.arcTransaction!, operationType } });
      await expect(transitionApplicationSubmission({ ...submitted, submissionTransaction: unsupportedTransaction, executionBinding: { ...binding, executionIntent: rawUnsupportedIntent } as unknown as typeof binding })).rejects.toThrow(InvalidTransitionError);
    }
    for (const actorType of ["AI", "FOUNDER", "PROVIDER", "EVALUATOR"] as const) await expect(transitionApplicationSubmission({ ...submitted, actor: { actorId: "adapter:authorized", actorType } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionApplicationSubmission({ ...submitted, actor: { actorId: "adapter:other", actorType: "ADAPTER" } })).rejects.toThrow(InvalidTransitionError);
  });
  it("requires exact transaction evidence for preparation and failure", () => {
    const makeTransaction = (status: "PREPARED" | "FAILED") => TransactionRecordSchema.parse({ id: `transaction:${status}`, projectId: "project:1", releaseRequestId: "release:1", intentId: "intent:1", destinationReference: "mock:recipient", approvalId: "approval:1", approvalBindingId: "binding:1", reconciliationId: null, idempotencyKey: `transaction:${status}:key`, amount: usdc("1"), operationState: status, arcTransaction: mockTransaction(status), createdAt: context.occurredAt, updatedAt: context.occurredAt });
    const adapter = { actorId: "adapter", actorType: "ADAPTER" as const };
    const evidence = (transaction: ReturnType<typeof makeTransaction>) => ({ ...context, aggregateId: transaction.releaseRequestId, actor: adapter, authorizedAdapterId: adapter.actorId, lifecycleTransaction: transaction, expectedTransactionId: transaction.id, expectedProjectId: transaction.projectId, expectedReleaseRequestId: transaction.releaseRequestId, expectedIntentId: transaction.intentId, expectedApprovalId: transaction.approvalId!, expectedApprovalBindingId: transaction.approvalBindingId! });
    const prepared = makeTransaction("PREPARED"); expect(transitionApplication("APPROVED", "PREPARED", evidence(prepared)).state).toBe("PREPARED");
    expect(() => transitionApplication("APPROVED", "PREPARED", { ...evidence(prepared), lifecycleTransaction: undefined })).toThrow();
    const failed = makeTransaction("FAILED"); expect(transitionApplication("PREPARED", "FAILED", evidence(failed)).state).toBe("FAILED"); expect(transitionApplication("SUBMITTED", "FAILED", evidence(failed)).state).toBe("FAILED");
    expect(() => transitionApplication("PREPARED", "FAILED", { ...context, actor: adapter, authorizedAdapterId: adapter.actorId })).toThrow();
    expect(() => transitionApplication("PREPARED", "FAILED", { ...evidence(failed), lifecycleTransaction: prepared })).toThrow();
  });
  it("requires exact confirmed transaction evidence before application confirmation", () => {
    const transaction = TransactionRecordSchema.parse({ id: "transaction:confirmation", projectId: "project:1", releaseRequestId: "release:1", intentId: "intent:1", destinationReference: "mock:recipient", approvalId: "approval:1", approvalBindingId: "binding:1", reconciliationId: null, idempotencyKey: "transaction:confirmation:key", amount: usdc("1"), operationState: "CONFIRMED", arcTransaction: mockTransaction("CONFIRMED"), createdAt: context.occurredAt, updatedAt: context.occurredAt });
    const confirmation = { ...context, aggregateId: transaction.releaseRequestId, actor: { actorId: "adapter:authorized", actorType: "ADAPTER" as const }, authorizedAdapterId: "adapter:authorized", confirmationTransaction: transaction, expectedTransactionId: transaction.id, expectedProjectId: transaction.projectId, expectedReleaseRequestId: transaction.releaseRequestId, expectedIntentId: transaction.intentId, expectedApprovalId: transaction.approvalId!, expectedApprovalBindingId: transaction.approvalBindingId!, expectedOperationType: transaction.arcTransaction!.operationType };
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: undefined })).toThrow(InvalidTransitionError);
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
    for (const operationType of ["JOB_FUND", "JOB_EVALUATE", "JOB_SUBMIT"] as const) {
      const otherOperation = TransactionRecordSchema.parse({ ...transaction, arcTransaction: mockTransaction("CONFIRMED", operationType) });
      expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: otherOperation, expectedOperationType: operationType })).toThrow(InvalidTransitionError);
    }
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, expectedOperationType: "REFUND" })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, expectedOperationType: undefined })).toThrow(InvalidTransitionError);
    expect(transitionApplication("SUBMITTED", "CONFIRMED", confirmation).state).toBe("CONFIRMED");
    const refundTransaction = TransactionRecordSchema.parse({ ...transaction, arcTransaction: mockTransaction("CONFIRMED", "REFUND") });
    expect(transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: refundTransaction, expectedOperationType: "REFUND" }).state).toBe("CONFIRMED");
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, confirmationTransaction: refundTransaction, expectedOperationType: "SETTLEMENT" })).toThrow(InvalidTransitionError);
    for (const actorType of ["AI", "FOUNDER", "EVALUATOR"] as const) expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, actor: { actorId: "adapter:authorized", actorType } })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication("SUBMITTED", "CONFIRMED", { ...confirmation, actor: { actorId: "adapter:other", actorType: "ADAPTER" } })).toThrow(InvalidTransitionError);
  });
  it("requires exact MATCHED evidence before application reconciliation", () => {
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
  it("requires the exact authorized evaluator and canonical evaluation evidence for terminal job decisions", async () => {
    const actor = { actorId: "mock:evaluator", actorType: "EVALUATOR" as const };
    const submittedCurrent = mockJob("SUBMITTED", mockTransaction("CONFIRMED", "JOB_SUBMIT"));
    const unconfirmedSubmittedCurrent = mockJob("SUBMITTED", mockTransaction("SUBMITTED", "JOB_SUBMIT"));
    const completed = mockJob("COMPLETED", mockTransaction("CONFIRMED", "JOB_EVALUATE"));
    const rejected = mockJob("REJECTED", mockTransaction("CONFIRMED", "JOB_EVALUATE"));
    const completedAuthorization = await jobEvaluationAuthorization(completed, "APPROVED");
    const rejectedAuthorization = await jobEvaluationAuthorization(rejected, "REJECTED");
    const completedContext = { ...context, aggregateId: completed.jobId, actor, currentJobEvidence: submittedCurrent, jobEvidence: completed, ...completedAuthorization };
    const rejectedContext = { ...context, aggregateId: rejected.jobId, actor, currentJobEvidence: submittedCurrent, jobEvidence: rejected, ...rejectedAuthorization };

    expect((await transitionAgenticJob("SUBMITTED", "COMPLETED", completedContext)).status).toBe("COMPLETED");
    expect((await transitionAgenticJob("SUBMITTED", "REJECTED", rejectedContext)).status).toBe("REJECTED");
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, currentJobEvidence: unconfirmedSubmittedCurrent })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, executionBinding: undefined })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, authorizedEvaluatorId: "mock:other-evaluator", actor: { actorId: "mock:other-evaluator", actorType: "EVALUATOR" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, actor: { actorId: "mock:other-evaluator", actorType: "EVALUATOR" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, jobEvidence: { ...completed, deliverableReference: "mock:replacement" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "REJECTED", { ...rejectedContext, jobEvidence: { ...rejected, reasonReference: null } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "REJECTED", { ...rejectedContext, jobEvaluationEvidence: { ...rejectedAuthorization.jobEvaluationEvidence, transactionHash: "mock:other" } })).rejects.toThrow(InvalidTransitionError);
    const evaluationTarget = completedAuthorization.executionBinding.executionIntent.protocolTarget;
    if (evaluationTarget.kind !== "ERC8183") throw new Error("Expected an ERC-8183 evaluation target.");
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, executionBinding: { ...completedAuthorization.executionBinding, executionIntent: { ...completedAuthorization.executionBinding.executionIntent, protocolTarget: { ...evaluationTarget, parameterCommitment: `sha256:${"a".repeat(64)}` } } } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...completedContext, jobApprovalDecision: { ...completedAuthorization.jobApprovalDecision, expiresAt: context.occurredAt } })).rejects.toThrow(InvalidTransitionError);
  });
  it("evidence-gates funding, submission, and expiry", async () => {
    const adapter = { actorId: "adapter", actorType: "ADAPTER" as const };
    const open = mockJob("OPEN");
    const funded = mockJob("FUNDED", mockTransaction("CONFIRMED", "JOB_FUND"));
    const fundingContext = { ...context, aggregateId: funded.jobId, actor: adapter, authorizedAdapterId: adapter.actorId, currentJobEvidence: open, jobEvidence: funded };
    expect((await transitionAgenticJob("OPEN", "FUNDED", fundingContext)).status).toBe("FUNDED");
    await expect(transitionAgenticJob("OPEN", "FUNDED", { ...fundingContext, currentJobEvidence: undefined })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("OPEN", "FUNDED", { ...fundingContext, currentJobEvidence: funded })).rejects.toThrow(InvalidTransitionError);
    for (const changed of [
      { budget: usdc("2") },
      { budget: money("EURC", "1") },
      { clientAddress: "mock:other-client" },
      { providerAddress: "mock:other-provider" },
      { evaluatorAddress: "mock:other-evaluator" },
      { contractAddress: "mock:other-contract" },
      { network: "mock:other-network" },
      { chainId: "mock:other-chain" },
      { expiresAt: "2026-01-02T00:00:00.000Z" },
      { descriptionReference: "mock:other-description" },
    ]) await expect(transitionAgenticJob("OPEN", "FUNDED", { ...fundingContext, jobEvidence: { ...funded, ...changed } as unknown as typeof funded })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("OPEN", "FUNDED", { ...fundingContext, jobEvidence: { ...funded, deliverableReference: "mock:deliverable" } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("OPEN", "FUNDED", { ...fundingContext, jobEvidence: { ...funded, reasonReference: "mock:reason" } })).rejects.toThrow(InvalidTransitionError);

    const submitted = mockJob("SUBMITTED", mockTransaction("SUBMITTED", "JOB_SUBMIT"));
    const submissionContext = { ...context, aggregateId: submitted.jobId, actor: adapter, authorizedAdapterId: adapter.actorId, currentJobEvidence: funded, jobEvidence: submitted, ...await providerSubmissionAuthorization(submitted) };
    expect((await transitionAgenticJob("FUNDED", "SUBMITTED", submissionContext)).status).toBe("SUBMITTED");
    await expect(transitionAgenticJob("FUNDED", "SUBMITTED", { ...submissionContext, jobApprovalDecision: undefined })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("FUNDED", "SUBMITTED", { ...submissionContext, executionBinding: undefined })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("FUNDED", "SUBMITTED", { ...submissionContext, authorizedProviderId: "mock:other-provider" })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("FUNDED", "SUBMITTED", { ...submissionContext, expectedExactIntentHash: `sha256:${"e".repeat(64)}` })).rejects.toThrow(InvalidTransitionError);
    const boundTarget = submissionContext.executionBinding!.executionIntent.protocolTarget;
    if (boundTarget.kind !== "ERC8183") throw new Error("Expected an ERC-8183 submission target.");
    await expect(transitionAgenticJob("FUNDED", "SUBMITTED", { ...submissionContext, executionBinding: { ...submissionContext.executionBinding!, executionIntent: { ...submissionContext.executionBinding!.executionIntent, protocolTarget: { ...boundTarget, parameterCommitment: `sha256:${"e".repeat(64)}` } } } })).rejects.toThrow(InvalidTransitionError);
    for (const currentJobEvidence of [mockJob("FUNDED"), mockJob("FUNDED", mockTransaction("SUBMITTED", "JOB_FUND")), mockJob("FUNDED", mockTransaction("CONFIRMED", "REFUND"))]) await expect(transitionAgenticJob("FUNDED", "SUBMITTED", { ...submissionContext, currentJobEvidence })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("FUNDED", "SUBMITTED", { ...submissionContext, jobEvidence: { ...submitted, deliverableReference: null } })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAgenticJob("FUNDED", "SUBMITTED", { ...submissionContext, jobEvidence: { ...submitted, reasonReference: "mock:reason" } })).rejects.toThrow(InvalidTransitionError);

    const system = { actorId: "system", actorType: "SYSTEM" as const };
    await expect(transitionAgenticJob("OPEN", "EXPIRED", { ...context, occurredAt: "2025-12-31T23:59:59.000Z", aggregateId: open.jobId, actor: system, authorizedSystemId: system.actorId, currentJobEvidence: open })).rejects.toThrow(InvalidTransitionError);
    expect((await transitionAgenticJob("OPEN", "EXPIRED", { ...context, aggregateId: open.jobId, actor: system, authorizedSystemId: system.actorId, currentJobEvidence: open })).status).toBe("EXPIRED");
    expect((await transitionAgenticJob("OPEN", "EXPIRED", { ...context, aggregateId: open.jobId, actor: system, authorizedSystemId: system.actorId, currentJobEvidence: open, jobEvidence: mockJob("EXPIRED") })).status).toBe("EXPIRED");
    for (const staleTarget of [mockJob("OPEN"), { ...mockJob("EXPIRED"), jobId: "mock:other" }, { ...mockJob("EXPIRED"), clientAddress: "mock:other-client" }, { ...mockJob("EXPIRED"), deliverableReference: "mock:forged-deliverable" }, { ...mockJob("EXPIRED"), reasonReference: "mock:forged-reason" }, { ...mockJob("EXPIRED"), transaction: mockTransaction("CONFIRMED", "REFUND") }]) await expect(transitionAgenticJob("OPEN", "EXPIRED", { ...context, aggregateId: open.jobId, actor: system, authorizedSystemId: system.actorId, currentJobEvidence: open, jobEvidence: staleTarget })).rejects.toThrow(InvalidTransitionError);
    const expiredSubmitted = AgenticJobRefSchema.parse({ ...submitted, status: "EXPIRED" });
    const submittedExpiry = { ...context, aggregateId: submitted.jobId, actor: system, authorizedSystemId: system.actorId, currentJobEvidence: submitted, jobEvidence: expiredSubmitted };
    expect((await transitionAgenticJob("SUBMITTED", "EXPIRED", submittedExpiry)).status).toBe("EXPIRED");
    for (const changed of [{ deliverableReference: "mock:forged-deliverable" }, { reasonReference: "mock:forged-reason" }, { transaction: mockTransaction("CONFIRMED", "REFUND") }]) await expect(transitionAgenticJob("SUBMITTED", "EXPIRED", { ...submittedExpiry, jobEvidence: { ...expiredSubmitted, ...changed } })).rejects.toThrow(InvalidTransitionError);
    for (const terminal of ["COMPLETED", "REJECTED", "EXPIRED"] as const) await expect(transitionAgenticJob(terminal, "FUNDED", { ...context, aggregateId: open.jobId, actor: adapter, authorizedAdapterId: adapter.actorId, currentJobEvidence: mockJob(terminal), jobEvidence: funded })).rejects.toThrow(InvalidTransitionError);
  });
});

describe("repositories and idempotency", () => {
  it("isolates stored records from caller mutation", () => {
    const repository = new InMemoryRepository<{ id: string; nested: { value: string } }>();
    const input = { id: "one", nested: { value: "original" } }; repository.create(input); input.nested.value = "changed";
    const read = repository.get("one")!; read.nested.value = "changed again";
    expect(repository.get("one")!.nested.value).toBe("original");
    expect(() => repository.create({ id: "one", nested: { value: "duplicate" } })).toThrow();
  });
  it("keeps audit history append-only and isolated", () => {
    const repository = new InMemoryAuditRepository(); const audit = transitionApplication("INCOMPLETE", "NEEDS_REVIEW", { ...context, authorizedSystemId: "system" }).auditEvent;
    repository.append(audit); const output = repository.list(); output[0]!.details.to = "tampered";
    expect(repository.list()[0]!.details.to).toBe("NEEDS_REVIEW");
    expect("update" in repository).toBe(false); expect("delete" in repository).toBe(false);
  });
  it("returns the original idempotent result and rejects conflicting reuse", async () => {
    const repository = new InMemoryIdempotencyRepository(); let executions = 0;
    const action = () => ({ id: `result:${++executions}` });
    await expect(repository.execute("release", "key", "fingerprint", action)).resolves.toEqual({ id: "result:1" });
    await expect(repository.execute("release", "key", "fingerprint", action)).resolves.toEqual({ id: "result:1" });
    expect(executions).toBe(1);
    expect(() => repository.execute("release", "key", "different", action)).toThrow(IdempotencyConflictError);
  });
  it("does not collide when scopes and keys contain separators", async () => {
    const repository = new InMemoryIdempotencyRepository();
    await expect(repository.execute("a:b", "c", "one", () => "first")).resolves.toBe("first");
    await expect(repository.execute("a", "b:c", "two", () => "second")).resolves.toBe("second");
  });
  it.each([
    ["allocation", AllocationOperationRecordSchema, { id: "allocation:1", reserveId: "reserve:1", idempotencyKey: "allocation:key", amount: usdc("1"), createdAt: context.occurredAt }],
    ["approval", ApprovalRecordSchema, { id: "approval:1", aggregateId: "release:1", intentId: "intent:1", actionKind: "RELEASE_APPROVAL", authorizedActorType: "FOUNDER", authorizedActorId: "founder:1", exactIntentHash: `sha256:${"a".repeat(64)}`, idempotencyKey: "approval:key", decision: "PENDING", approver: null, expiresAt: context.occurredAt, decidedAt: null }],
    ["submission", SubmissionOperationRecordSchema, { id: "submission:1", transactionId: "transaction:1", idempotencyKey: "submission:key", createdAt: context.occurredAt }],
    ["settlement", SettlementRecordSchema, { id: "settlement:1", projectId: "project:1", releaseRequestId: "release:1", reconciliationId: null, idempotencyKey: "settlement:key", amount: usdc("1"), state: "PENDING", job: null, transaction: null, updatedAt: context.occurredAt }],
    ["recovery", RecoveryOperationRecordSchema, { id: "recovery:1", proofGapId: "gap:1", idempotencyKey: "recovery:key", responseReference: "private:response:1", createdAt: context.occurredAt }],
  ])("directly models and deduplicates %s operations", async (scope: string, schema: { parse(value: unknown): { id: string; idempotencyKey: string } }, record: unknown) => {
    const parsed = schema.parse(record); const repository = new InMemoryIdempotencyRepository(); let calls = 0;
    await expect(repository.execute(scope, parsed.idempotencyKey, JSON.stringify(parsed), () => ({ parsed, calls: ++calls }))).resolves.toEqual(await repository.execute(scope, parsed.idempotencyKey, JSON.stringify(parsed), () => ({ parsed, calls: ++calls })));
    expect(calls).toBe(1);
  });
  it("shares one in-flight action while cloning each caller result", async () => {
    const repository = new InMemoryIdempotencyRepository(); let executions = 0; let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const action = async () => { executions += 1; await gate; return { nested: { value: "original" } }; };
    const first = repository.execute("scope", "key", "same", action); const second = repository.execute("scope", "key", "same", action); release();
    const [firstResult, secondResult] = await Promise.all([first, second]); firstResult.nested.value = "changed";
    expect(executions).toBe(1); expect(secondResult.nested.value).toBe("original"); await expect(repository.execute("scope", "key", "same", action)).resolves.toEqual({ nested: { value: "original" } });
  });
  it("rejects in-flight conflicts and tombstones rejected actions", async () => {
    const repository = new InMemoryIdempotencyRepository(); let executions = 0;
    const rejected = repository.execute("scope", "key", "first", async () => { executions += 1; throw new Error("failed"); });
    expect(() => repository.execute("scope", "key", "different", () => "never")).toThrow(IdempotencyConflictError);
    await expect(rejected).rejects.toThrow("failed"); await expect(repository.execute("scope", "key", "first", () => { executions += 1; return "retried"; })).rejects.toThrow("failed"); expect(executions).toBe(1);
  });
  it("tombstones uncloneable resolved results for every concurrent caller", async () => {
    const repository = new InMemoryIdempotencyRepository(); let executions = 0;
    const action = async () => { executions += 1; return { uncloneable: () => "value" }; };
    const first = repository.execute("scope", "uncloneable", "same", action);
    const second = repository.execute("scope", "uncloneable", "same", action);
    const settled = await Promise.allSettled([first, second]);
    expect(settled.every((result) => result.status === "rejected")).toBe(true);
    expect(executions).toBe(1);
    await expect(repository.execute("scope", "uncloneable", "same", action)).rejects.toBeDefined();
    expect(executions).toBe(1);
    expect(() => repository.execute("scope", "uncloneable", "different", action)).toThrow(IdempotencyConflictError);
  });
});

describe("protocol-safe mocks and privacy", () => {
  it("uses visibly synthetic wallet and unregistered identity references", () => {
    expect(new MockWalletReferenceAdapter().getReference()).toMatchObject({ mode: "MOCK", canSubmitTransactions: false, balanceAtomic: "1000000000" });
    expect(new MockIdentityAdapter().getIdentity()).toMatchObject({ isMock: true, registrationStatus: "UNREGISTERED", registrationReference: null, metadataVersion: "1" });
  });
  it("does not permit case-insensitive owner-written reputation", () => {
    expect(() => AgentReputationRefSchema.parse({ standard: "ERC-8004", network: "mock:network", chainId: "mock:chain", registryAddress: "mock:registry", agentId: "mock:agent", writerAddress: "mock:Writer", agentOwnerAddress: "MOCK:writer", eventReference: "mock:event", score: 1, tag: null, recordedAt: null, isMock: true })).toThrow();
  });
  it("rejects confirmed transaction state without a hash", () => {
    const transaction = { network: "ARC_TESTNET" as const, chainId: "synthetic:chain", transactionHash: null, status: "CONFIRMED" as const, blockNumber: null, blockHash: null, explorerUrl: null, operationType: "SETTLEMENT" as const, isMock: true };
    expect(() => ArcTransactionRefSchema.parse(transaction)).toThrow();
    expect(() => TransactionRecordSchema.parse({ id: "tx:1", projectId: "project:1", releaseRequestId: "release:1", intentId: "intent:1", destinationReference: "mock:recipient", approvalId: "approval:1", approvalBindingId: "binding:1", reconciliationId: null, idempotencyKey: "tx:key", amount: usdc("1"), operationState: "CONFIRMED", arcTransaction: null, createdAt: context.occurredAt, updatedAt: context.occurredAt })).toThrow();
  });
  it("rejects registered identity without its registration reference", () => {
    const identity = new MockIdentityAdapter().getIdentity();
    expect(() => AgentIdentityRefSchema.parse({ ...identity, registrationStatus: "REGISTERED" })).toThrow();
  });
  it("rejects a synthetic registration reference on a live identity", () => {
    expect(() => AgentIdentityRefSchema.parse({ standard: "ERC-8004", network: "ARC_TESTNET", chainId: "5042002", registryAddress: "0x1111111111111111111111111111111111111111", agentId: "1", ownerAddress: "0x2222222222222222222222222222222222222222", metadataVersion: "1", registrationStatus: "REGISTERED", registrationReference: "synthetic:registration", isMock: false })).toThrow();
  });
  it("defers every live ERC-8004 identity to Issue #13", () => {
    const result = AgentIdentityRefSchema.safeParse({ standard: "ERC-8004", network: "ARC_TESTNET", chainId: "5042002", registryAddress: "0x1111111111111111111111111111111111111111", agentId: "1", ownerAddress: "0x2222222222222222222222222222222222222222", metadataVersion: "1", registrationStatus: "REGISTERED", registrationReference: `0x${"3".repeat(64)}`, isMock: false });
    expect(result.success).toBe(false); if (!result.success) expect(result.error.issues.some((issue: { message: string }) => issue.message.includes("deferred to Issue #13"))).toBe(true);
  });
  it("rejects non-synthetic mock identifiers and synthetic live identifiers", () => {
    const identity = new MockIdentityAdapter().getIdentity();
    expect(() => AgentIdentityRefSchema.parse({ ...identity, agentId: "not-mock" })).toThrow();
    expect(() => AgentIdentityRefSchema.parse({ ...identity, isMock: false })).toThrow();
  });
  it("keeps evidence private and excludes raw content and notes", () => {
    const evidence = EvidenceItemSchema.parse({ id: "e1", projectId: "p1", kind: "RECEIPT", sourceHash: `sha256:${"a".repeat(64)}`, storageRef: "private://e1", visibility: "FOUNDER_PRIVATE", submittedAt: "2026-01-01T00:00:00.000Z", rawContent: "secret", privateNotes: "secret" });
    expect(evidence).not.toHaveProperty("rawContent"); expect(evidence).not.toHaveProperty("privateNotes");
  });
  it("transitions only mock jobs without contract behavior", async () => {
    const job = { standard: "ERC-8183" as const, network: "synthetic:arc-testnet", chainId: "synthetic:chain", contractAddress: "mock:not-a-contract", jobId: "mock:job", clientAddress: "mock:client", providerAddress: "mock:provider", evaluatorAddress: "mock:evaluator", budget: usdc("250000000"), expiresAt: "2026-02-01T00:00:00.000Z", descriptionReference: "mock:description", deliverableReference: null, reasonReference: null, status: "OPEN" as const, transaction: null, isMock: true };
    expect(AgenticJobRefSchema.parse(job)).toEqual(job);
    const adapter = new MockAgenticJobAdapter(); const authority = { ...context, aggregateId: job.jobId, actor: { actorId: "adapter", actorType: "ADAPTER" as const }, authorizedAdapterId: "adapter" };
    await expect(adapter.transition(job, "FUNDED", authority)).rejects.toThrow(InvalidTransitionError);
    const funded = AgenticJobRefSchema.parse({ ...job, status: "FUNDED", transaction: mockTransaction("CONFIRMED", "JOB_FUND") });
    expect((await adapter.transition(job, "FUNDED", { ...authority, currentJobEvidence: { ...job, budget: usdc("1") }, jobEvidence: funded })).job.status).toBe("FUNDED"); expect(job.status).toBe("OPEN");
    await expect(adapter.transition(funded, "SUBMITTED", authority)).rejects.toThrow(InvalidTransitionError);
    const submitted = AgenticJobRefSchema.parse({ ...funded, status: "SUBMITTED", deliverableReference: "mock:deliverable", transaction: mockTransaction("SUBMITTED", "JOB_SUBMIT") });
    const submissionAuthority = { ...authority, currentJobEvidence: funded, jobEvidence: submitted, ...await providerSubmissionAuthorization(submitted) };
    expect((await adapter.transition(funded, "SUBMITTED", submissionAuthority)).job.status).toBe("SUBMITTED");
    await expect(adapter.transition(funded, "SUBMITTED", { ...authority, jobEvidence: { ...submitted, deliverableReference: null } })).rejects.toThrow(InvalidTransitionError);
    const systemAuthority = { ...context, occurredAt: job.expiresAt, aggregateId: job.jobId, actor: { actorId: "system", actorType: "SYSTEM" as const }, authorizedSystemId: "system" };
    expect((await adapter.transition(job, "EXPIRED", systemAuthority)).job.status).toBe("EXPIRED");
    expect((await adapter.transition(job, "EXPIRED", { ...systemAuthority, jobEvidence: AgenticJobRefSchema.parse({ ...job, status: "EXPIRED" }) })).job.status).toBe("EXPIRED");
    for (const staleTarget of [job, AgenticJobRefSchema.parse({ ...job, status: "EXPIRED", jobId: "mock:other" }), AgenticJobRefSchema.parse({ ...job, status: "EXPIRED", providerAddress: "mock:other-provider" }), AgenticJobRefSchema.parse({ ...job, status: "EXPIRED", deliverableReference: "mock:forged-deliverable" }), AgenticJobRefSchema.parse({ ...job, status: "EXPIRED", reasonReference: "mock:forged-reason" }), AgenticJobRefSchema.parse({ ...job, status: "EXPIRED", transaction: mockTransaction("CONFIRMED", "SETTLEMENT") })]) await expect(adapter.transition(job, "EXPIRED", { ...systemAuthority, jobEvidence: staleTarget })).rejects.toThrow(InvalidTransitionError);
    expect(() => AgenticJobRefSchema.parse({ ...job, network: "ARC_TESTNET", chainId: "5042002", contractAddress: "0x1111111111111111111111111111111111111111", jobId: "1", clientAddress: "0x2222222222222222222222222222222222222222", providerAddress: "0x3333333333333333333333333333333333333333", evaluatorAddress: "0x4444444444444444444444444444444444444444", descriptionReference: "description", isMock: false })).toThrow(/deferred to Issue #8/);
  });
  it("requires every protocol-reference field", () => {
    const identity = new MockIdentityAdapter().getIdentity(); const { metadataVersion: _metadataVersion, ...missingIdentity } = identity;
    expect(() => AgentIdentityRefSchema.parse(missingIdentity)).toThrow();
    expect(() => AgentReputationRefSchema.parse({ standard: "ERC-8004", network: "mock:network", chainId: "mock:chain", registryAddress: "mock:registry", agentId: "mock:agent", writerAddress: "mock:writer", agentOwnerAddress: "mock:owner", eventReference: "mock:event", score: null, tag: null, recordedAt: null, isMock: true })).toThrow();
    expect(() => ArcTransactionRefSchema.parse({ network: "ARC_TESTNET", chainId: "synthetic:chain", transactionHash: null, status: "PREPARED", blockNumber: null, blockHash: null, explorerUrl: null, isMock: true })).toThrow();
    expect(() => AgenticJobRefSchema.parse({ standard: "ERC-8183", network: "mock:network", chainId: "mock:chain", contractAddress: "mock:contract", jobId: "mock:job", clientAddress: "mock:client", providerAddress: "mock:provider", evaluatorAddress: "mock:evaluator", status: "OPEN", transaction: null, isMock: true })).toThrow();
  });
  it("defers live reputation writes while preserving mock reputation rules", () => {
    const base = { standard: "ERC-8004" as const, network: "ARC_TESTNET", chainId: "5042002", registryAddress: "registry", agentId: "1", eventReference: "event:1", score: 1, tag: null, recordedAt: context.occurredAt, isMock: false };
    expect(() => AgentReputationRefSchema.parse({ ...base, writerAddress: "0x1111111111111111111111111111111111111111", agentOwnerAddress: "0x2222222222222222222222222222222222222222" })).toThrow(/deferred to Issue #13/);
    expect(AgentReputationRefSchema.parse({ standard: "ERC-8004", network: "mock:network", chainId: "mock:chain", registryAddress: "mock:registry", agentId: "mock:agent", writerAddress: "mock:writer", agentOwnerAddress: "mock:owner", eventReference: "mock:event", score: 1, tag: null, recordedAt: null, isMock: true })).toBeDefined();
    expect(() => AgentReputationRefSchema.parse({ ...base, writerAddress: "not-an-address", agentOwnerAddress: "0x2222222222222222222222222222222222222222" })).toThrow();
    expect(() => AgentReputationRefSchema.parse({ ...base, writerAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", agentOwnerAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).toThrow();
  });
});

describe("lifecycle evidence schemas", () => {
  it("requires authorized completed approvals and empty pending decisions", () => {
    const base = { id: "approval:1", aggregateId: "release:1", intentId: "intent:1", actionKind: "RELEASE_APPROVAL", authorizedActorType: "FOUNDER", authorizedActorId: "founder:1", exactIntentHash: `sha256:${"e".repeat(64)}`, idempotencyKey: "approval:key", expiresAt: context.occurredAt };
    expect(ApprovalRecordSchema.parse({ ...base, decision: "APPROVED", approver: { actorId: "founder:1", actorType: "FOUNDER" }, decidedAt: context.occurredAt })).toBeDefined();
    expect(() => ApprovalRecordSchema.parse({ ...base, expiresAt: "2025-12-31T23:59:59.000Z", decision: "APPROVED", approver: { actorId: "founder:1", actorType: "FOUNDER" }, decidedAt: context.occurredAt })).toThrow(/after expiration/);
    expect(() => ApprovalRecordSchema.parse({ ...base, decision: "REJECTED", approver: { actorId: "founder:other", actorType: "FOUNDER" }, decidedAt: context.occurredAt })).toThrow();
    const evaluation = { ...base, actionKind: "JOB_EVALUATION", authorizedActorType: "EVALUATOR", authorizedActorId: "evaluator:1" };
    expect(ApprovalRecordSchema.parse({ ...evaluation, decision: "APPROVED", approver: { actorId: "evaluator:1", actorType: "EVALUATOR" }, decidedAt: context.occurredAt })).toBeDefined();
    expect(() => ApprovalRecordSchema.parse({ ...evaluation, decision: "APPROVED", approver: { actorId: "founder:1", actorType: "FOUNDER" }, decidedAt: context.occurredAt })).toThrow();
    const submission = { ...base, actionKind: "JOB_SUBMISSION", authorizedActorType: "PROVIDER", authorizedActorId: "mock:provider" };
    expect(ApprovalRecordSchema.parse({ ...submission, decision: "APPROVED", approver: { actorId: "mock:provider", actorType: "PROVIDER" }, decidedAt: context.occurredAt })).toBeDefined();
    expect(() => ApprovalRecordSchema.parse({ ...submission, decision: "APPROVED", approver: { actorId: "adapter:1", actorType: "ADAPTER" }, decidedAt: context.occurredAt })).toThrow();
    expect(() => ApprovalRecordSchema.parse({ ...base, decision: "APPROVED", approver: { actorId: "ai:1", actorType: "AI" }, decidedAt: context.occurredAt })).toThrow();
    expect(() => ApprovalRecordSchema.parse({ ...base, decision: "PENDING", approver: { actorId: "founder:1", actorType: "FOUNDER" }, decidedAt: context.occurredAt })).toThrow();
  });
  it("requires persisted approvals and settlement references only in compatible release states", () => {
    const base = { id: "release:1", projectId: "project:1", milestoneId: "milestone:1", proofId: "proof:1", intentId: "intent:1", settlementId: null, amount: usdc("1"), idempotencyKey: "release:key", createdAt: context.occurredAt };
    expect(() => ReleaseRequestSchema.parse({ ...base, state: "APPROVED", approvalId: null })).toThrow();
    expect(() => ReleaseRequestSchema.parse({ ...base, state: "RECONCILED", approvalId: null, settlementId: "settlement:1" })).toThrow();
    expect(() => ReleaseRequestSchema.parse({ ...base, state: "RECONCILED", approvalId: "approval:1", settlementId: null })).toThrow();
    expect(() => ReleaseRequestSchema.parse({ ...base, state: "DRAFT", approvalId: "approval:1" })).toThrow();
    expect(ReleaseRequestSchema.parse({ ...base, state: "SUBMITTED", approvalId: "approval:1" })).toBeDefined();
    expect(ReleaseRequestSchema.parse({ ...base, state: "RECONCILED", approvalId: "approval:1", settlementId: "settlement:1" })).toBeDefined();
    for (const state of ["DRAFT", "ELIGIBLE", "APPROVAL_PENDING", "APPROVED", "PREPARED", "SUBMITTED", "REJECTED", "FAILED"] as const) {
      const approvalId = state === "APPROVED" || state === "PREPARED" || state === "SUBMITTED" ? "approval:1" : null;
      expect(() => ReleaseRequestSchema.parse({ ...base, state, approvalId, settlementId: "settlement:1" })).toThrow();
    }
  });
  it("enforces transaction operation-state parity", () => {
    const base = { id: "transaction:1", projectId: "project:1", releaseRequestId: "release:1", intentId: "intent:1", destinationReference: "mock:recipient", approvalId: "approval:1", approvalBindingId: "binding:1", reconciliationId: null, idempotencyKey: "transaction:key", amount: usdc("1"), createdAt: context.occurredAt, updatedAt: context.occurredAt };
    expect(() => TransactionRecordSchema.parse({ ...base, operationState: "SUBMITTED", arcTransaction: null })).toThrow();
    expect(() => TransactionRecordSchema.parse({ ...base, operationState: "SUBMITTED", arcTransaction: mockTransaction("PREPARED") })).toThrow();
    expect(TransactionRecordSchema.parse({ ...base, operationState: "SUBMITTED", arcTransaction: mockTransaction("SUBMITTED") })).toBeDefined();
    expect(TransactionRecordSchema.parse({ ...base, operationState: "RECONCILED", reconciliationId: "reconciliation:1", arcTransaction: mockTransaction("CONFIRMED") })).toBeDefined();
    expect(TransactionRecordSchema.parse({ ...base, operationState: "FAILED", arcTransaction: mockTransaction("FAILED") })).toBeDefined();
    expect(() => TransactionRecordSchema.parse({ ...base, approvalId: null, approvalBindingId: null, operationState: "FAILED", arcTransaction: mockTransaction("FAILED") })).toThrow();
    expect(() => TransactionRecordSchema.parse({ ...base, operationState: "FAILED", arcTransaction: mockTransaction("CONFIRMED") })).toThrow();

    const liveDestination = `0x${"1".repeat(40)}`;
    for (const operationType of ["SETTLEMENT", "REFUND"] as const) {
      const arcTransaction = { ...liveTransaction, operationType };
      expect(TransactionRecordSchema.parse({ ...base, destinationReference: liveDestination, operationState: "CONFIRMED", arcTransaction })).toBeDefined();
      expect(() => TransactionRecordSchema.parse({ ...base, destinationReference: "mock:recipient", operationState: "CONFIRMED", arcTransaction })).toThrow();
      expect(() => TransactionRecordSchema.parse({ ...base, destinationReference: liveDestination, operationState: "CONFIRMED", arcTransaction: mockTransaction("CONFIRMED", operationType) })).toThrow();
    }
  });
  it("restricts LaunchVault value-moving records to USDC", async () => {
    const { vault } = createPawPovAiSeed();
    expect(LaunchVaultSchema.parse(vault).asset).toBe("USDC");
    expect(ReserveSchema.parse({ id: "reserve:1", vaultId: vault.id, name: "Reserve", allocated: usdc("1"), status: "ACTIVE" })).toBeDefined();
    expect(AllocationRuleSchema.parse({ id: "rule:1", reserveId: "reserve:1", purpose: "Demo", maximum: usdc("1"), requiresApproval: true })).toBeDefined();
    for (const asset of ["EURC", "ETH", "OTHER", ""]) {
      expect(() => LaunchVaultSchema.parse({ ...vault, asset, totalCapital: money(asset, "1") })).toThrow();
      expect(() => TransactionRecordSchema.parse({ id: "tx:asset", projectId: "project:1", releaseRequestId: "release:1", intentId: "intent:1", destinationReference: "mock:recipient", approvalId: "approval:1", approvalBindingId: "binding:1", reconciliationId: null, idempotencyKey: "tx:key", amount: money(asset, "1"), operationState: "PREPARED", arcTransaction: mockTransaction("PREPARED"), createdAt: context.occurredAt, updatedAt: context.occurredAt })).toThrow();
    }
  });
  it("enforces transaction and block evidence for every Arc lifecycle", () => {
    expect(ArcTransactionRefSchema.parse(mockTransaction("NONE"))).toBeDefined(); expect(ArcTransactionRefSchema.parse(mockTransaction("PREPARED"))).toBeDefined();
    expect(() => ArcTransactionRefSchema.parse({ ...mockTransaction("NONE"), transactionHash: "mock:transaction" })).toThrow();
    expect(() => ArcTransactionRefSchema.parse({ ...mockTransaction("SUBMITTED"), transactionHash: null })).toThrow();
    expect(() => ArcTransactionRefSchema.parse({ ...mockTransaction("CONFIRMED"), blockHash: null })).toThrow();
    expect(ArcTransactionRefSchema.parse(liveTransaction)).toEqual(liveTransaction);
    expect(() => ArcTransactionRefSchema.parse({ ...liveTransaction, chainId: "1" })).toThrow();
    expect(() => ArcTransactionRefSchema.parse({ ...liveTransaction, transactionHash: "0x1234" })).toThrow();
    expect(() => ArcTransactionRefSchema.parse({ ...liveTransaction, explorerUrl: `${liveTransaction.explorerUrl}wrong` })).toThrow();
    const failedWithoutHash = { ...liveTransaction, status: "FAILED" as const, transactionHash: null, blockNumber: null, blockHash: null, explorerUrl: null };
    expect(ArcTransactionRefSchema.parse(failedWithoutHash)).toEqual(failedWithoutHash);
    expect(() => ArcTransactionRefSchema.parse({ ...failedWithoutHash, explorerUrl: "https://testnet.arcscan.app/tx/unbound" })).toThrow();
  });
  it("requires truthful settlement, refund, and reconciliation evidence", () => {
    const base = { id: "settlement:1", projectId: "project:1", releaseRequestId: "release:1", reconciliationId: null, idempotencyKey: "settlement:key", amount: usdc("1"), job: null, updatedAt: context.occurredAt };
    expect(() => SettlementRecordSchema.parse({ ...base, state: "CONFIRMED", transaction: null })).toThrow();
    expect(() => SettlementRecordSchema.parse({ ...base, state: "CONFIRMED", transaction: mockTransaction("SUBMITTED") })).toThrow();
    expect(SettlementRecordSchema.parse({ ...base, state: "CONFIRMED", transaction: mockTransaction("CONFIRMED") })).toBeDefined();
    expect(() => SettlementRecordSchema.parse({ ...base, state: "REFUNDED", transaction: mockTransaction("CONFIRMED") })).toThrow();
    expect(SettlementRecordSchema.parse({ ...base, state: "REFUNDED", transaction: mockTransaction("CONFIRMED", "REFUND") })).toBeDefined();
    expect(() => SettlementRecordSchema.parse({ ...base, state: "RECONCILED", transaction: null })).toThrow();
    const completedJob = { standard: "ERC-8183" as const, network: "synthetic:arc-testnet", chainId: "synthetic:chain", contractAddress: "mock:contract", jobId: "mock:job", clientAddress: "mock:client", providerAddress: "mock:provider", evaluatorAddress: "mock:evaluator", budget: usdc("1"), expiresAt: "2026-02-01T00:00:00.000Z", descriptionReference: "mock:description", deliverableReference: "mock:deliverable", reasonReference: null, status: "COMPLETED" as const, transaction: null, isMock: true };
    expect(() => SettlementRecordSchema.parse({ ...base, state: "CONFIRMED", job: completedJob, transaction: null })).toThrow();
  });
  it.each([
    ["PENDING", null, true], ["PENDING", mockTransaction("PREPARED"), true], ["PENDING", mockTransaction("SUBMITTED"), true], ["PENDING", mockTransaction("CONFIRMED"), false],
    ["CONFIRMED", mockTransaction("CONFIRMED"), true], ["CONFIRMED", null, false],
    ["REFUND_PENDING", null, true], ["REFUND_PENDING", mockTransaction("PREPARED", "REFUND"), true], ["REFUND_PENDING", mockTransaction("SUBMITTED", "REFUND"), true], ["REFUND_PENDING", mockTransaction("SUBMITTED"), false],
    ["REFUNDED", mockTransaction("CONFIRMED", "REFUND"), true], ["REFUNDED", mockTransaction("CONFIRMED"), false],
    ["RECONCILED", mockTransaction("CONFIRMED"), true], ["RECONCILED", mockTransaction("CONFIRMED", "REFUND"), true], ["RECONCILED", mockTransaction("SUBMITTED"), false],
    ["FAILED", null, true], ["FAILED", mockTransaction("FAILED"), true], ["FAILED", mockTransaction("CONFIRMED"), false],
  ] as const)("validates %s settlement evidence", (state: "PENDING" | "CONFIRMED" | "REFUND_PENDING" | "REFUNDED" | "RECONCILED" | "FAILED", transaction: ReturnType<typeof mockTransaction> | null, valid: boolean) => {
    const candidate = { id: "settlement:matrix", projectId: "project:1", releaseRequestId: "release:1", reconciliationId: state === "RECONCILED" ? "reconciliation:1" : null, idempotencyKey: "settlement:key", amount: usdc("1"), state, job: null, transaction, updatedAt: context.occurredAt };
    expect(SettlementRecordSchema.safeParse(candidate).success).toBe(valid);
  });
  it("rejects unsupported confirmed settlement disclosure", () => {
    const seed = createPawPovAiSeed();
    expect(() => filterBackerDisclosure({ project: seed.project, evidence: [], proofs: [], settlements: [{ id: "settlement:bad", projectId: seed.project.id, releaseRequestId: "release:1", reconciliationId: null, idempotencyKey: "settlement:key", amount: usdc("1"), state: "CONFIRMED", job: null, transaction: null, updatedAt: context.occurredAt }], preferences: { ...seed.disclosurePreferences, discloseSettlementState: true } })).toThrow();
  });
});

describe("persisted relationship integrity", () => {
  async function authorizationFixture() {
    const release = ReleaseRequestSchema.parse({ id: "release:1", projectId: "project:1", milestoneId: "milestone:1", proofId: "proof:1", intentId: "intent:1", settlementId: null, amount: usdc("100"), state: "PREPARED", approvalId: "approval:1", idempotencyKey: "release:key", createdAt: context.occurredAt });
    const transaction = TransactionRecordSchema.parse({ id: "transaction:1", projectId: release.projectId, releaseRequestId: release.id, intentId: release.intentId, destinationReference: "mock:recipient", approvalId: "approval:1", approvalBindingId: "binding:1", reconciliationId: null, idempotencyKey: "transaction:key", amount: release.amount, operationState: "PREPARED", arcTransaction: mockTransaction("PREPARED"), createdAt: context.occurredAt, updatedAt: context.occurredAt });
    const executionIntent = { version: 1 as const, actionKind: "RELEASE_APPROVAL" as const, projectId: release.projectId, releaseRequestId: release.id, transactionRecordId: transaction.id, intentId: release.intentId, asset: release.amount.asset, atomicAmount: release.amount.atomicUnits, operationType: transaction.arcTransaction!.operationType, protocolTarget: { kind: "DESTINATION" as const, destination: transaction.destinationReference, network: transaction.arcTransaction!.network, chainId: transaction.arcTransaction!.chainId } };
    const exactIntentHash = await hashCanonicalExecutionIntent(executionIntent);
    const approval = ApprovalRecordSchema.parse({ id: "approval:1", aggregateId: release.id, intentId: release.intentId, actionKind: "RELEASE_APPROVAL", authorizedActorType: "FOUNDER", authorizedActorId: "founder:1", exactIntentHash, idempotencyKey: "approval:key", decision: "APPROVED", approver: { actorId: "founder:1", actorType: "FOUNDER" }, expiresAt: "2027-01-01T00:00:00.000Z", decidedAt: context.occurredAt });
    const binding = { id: "binding:1", releaseRequestId: release.id, approvalId: approval.id, intentId: release.intentId, exactIntentHash, transactionRecordId: transaction.id, executionIntent, status: "ACTIVE" as const, consumedAt: null, consumedByTransactionId: null, createdAt: context.occurredAt };
    return { approval, release, transaction, binding };
  }
  it("uses one deterministic ordered canonical intent serialization and hash", async () => {
    const { binding } = await authorizationFixture(); expect(JSON.parse(serializeCanonicalExecutionIntent(binding.executionIntent))).toEqual([1, "RELEASE_APPROVAL", "project:1", "release:1", "transaction:1", "intent:1", "USDC", "100", "SETTLEMENT", "DESTINATION", "mock:recipient", "ARC_TESTNET", "synthetic:chain"]); expect(binding.exactIntentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
  it("validates only the recomputed exact approved execution intent", async () => {
    const { approval, release, transaction, binding } = await authorizationFixture();
    await expect(validateExecutionAuthorization(approval, release, transaction, binding, context.occurredAt)).resolves.toBe(true);
    for (const changed of [{ ...transaction, amount: usdc("101") }, { ...transaction, amount: usdc("99") }, { ...transaction, amount: money("EURC", "100") }, { ...transaction, destinationReference: "mock:other" }, { ...transaction, projectId: "project:other" }, { ...transaction, releaseRequestId: "release:other" }, { ...transaction, id: "transaction:other" }, { ...transaction, intentId: "intent:other" }, { ...transaction, arcTransaction: { ...transaction.arcTransaction!, operationType: "REFUND" as const } }, { ...transaction, arcTransaction: { ...transaction.arcTransaction!, chainId: "mock:other-chain" } }]) await expect(validateExecutionAuthorization(approval, release, changed as never, binding, context.occurredAt)).rejects.toThrow();
    await expect(validateExecutionAuthorization({ ...approval, actionKind: "JOB_EVALUATION" as const } as never, release, transaction, binding, context.occurredAt)).rejects.toThrow();
    await expect(validateExecutionAuthorization(approval, release, transaction, { ...binding, executionIntent: { ...binding.executionIntent, atomicAmount: "101" } }, context.occurredAt)).rejects.toThrow();
    await expect(validateExecutionAuthorization(approval, release, transaction, { ...binding, exactIntentHash: `sha256:${"0".repeat(64)}` }, context.occurredAt)).rejects.toThrow();
  });
  it("continues rejecting invalid or unrelated approvals", async () => {
    const { approval, release, transaction, binding } = await authorizationFixture();
    await expect(validateExecutionAuthorization({ ...approval, decision: "PENDING", approver: null, decidedAt: null }, release, transaction, binding, context.occurredAt)).rejects.toThrow();
    await expect(validateExecutionAuthorization({ ...approval, decision: "REJECTED" }, release, transaction, binding, context.occurredAt)).rejects.toThrow();
    await expect(validateExecutionAuthorization(approval, release, transaction, binding, "2028-01-01T00:00:00.000Z")).rejects.toThrow();
    await expect(validateExecutionAuthorization(approval, { ...release, approvalId: "approval:other" }, transaction, binding, context.occurredAt)).rejects.toThrow();
    expect(() => TransactionRecordSchema.parse({ ...transaction, approvalBindingId: null })).toThrow();
  });
  it("enforces approval decision chronology at authorization time", async () => {
    const { approval, release, transaction, binding } = await authorizationFixture();
    const authorize = (decidedAt: string, asOf: string, expiresAt = approval.expiresAt) => validateExecutionAuthorization({ ...approval, decidedAt, expiresAt }, release, transaction, binding, asOf);
    await expect(authorize("2025-12-31T23:59:59.000Z", context.occurredAt)).resolves.toBe(true);
    await expect(authorize(context.occurredAt, context.occurredAt)).resolves.toBe(true);
    await expect(authorize("2026-01-01T00:00:01.000Z", context.occurredAt)).rejects.toThrow(/decidedAt/);
    await expect(authorize("2027-01-01T00:00:01.000Z", context.occurredAt)).rejects.toThrow(/after expiration/);
    await expect(authorize(context.occurredAt, approval.expiresAt)).rejects.toThrow(/decidedAt/);
    await expect(authorize(context.occurredAt, "2027-01-01T00:00:01.000Z")).rejects.toThrow(/decidedAt/);
    await expect(authorize(context.occurredAt, "not-a-timestamp")).rejects.toThrow(/timestamp/);
  });
  it("is a PREPARED-only authorization gate", async () => {
    const { approval, release, transaction, binding } = await authorizationFixture();
    for (const operationState of ["SUBMITTED", "CONFIRMED", "FAILED", "RECONCILED"] as const) await expect(validateExecutionAuthorization(approval, release, { ...transaction, operationState }, binding, context.occurredAt)).rejects.toThrow();
    await expect(validateExecutionAuthorization(approval, { ...release, state: "APPROVED" }, transaction, binding, context.occurredAt)).rejects.toThrow();
    for (const status of ["CONSUMED", "REVOKED"] as const) await expect(validateExecutionAuthorization(approval, release, transaction, { ...binding, status }, context.occurredAt)).rejects.toThrow();
  });
  it("derives approval policy internally and fails closed for deferred operations", async () => {
    const { approval, release, transaction, binding } = await authorizationFixture();
    await expect(validateExecutionAuthorization({ ...approval, actionKind: "JOB_EVALUATION", authorizedActorType: "EVALUATOR", authorizedActorId: "evaluator:1", approver: { actorId: "evaluator:1", actorType: "EVALUATOR" } }, release, transaction, binding, context.occurredAt)).rejects.toThrow();
    const deferredIntent = { ...binding.executionIntent, operationType: "JOB_CREATE" as const };
    await expect(validateExecutionAuthorization(approval, release, { ...transaction, arcTransaction: { ...transaction.arcTransaction!, operationType: "JOB_CREATE" } }, { ...binding, executionIntent: deferredIntent }, context.occurredAt)).rejects.toThrow();
  });
  it.each([
    ["REFUND", "RELEASE_APPROVAL", "FOUNDER"], ["JOB_FUND", "RELEASE_APPROVAL", "FOUNDER"], ["JOB_SUBMIT", "JOB_SUBMISSION", "PROVIDER"], ["JOB_EVALUATE", "JOB_EVALUATION", "EVALUATOR"],
  ] as const)("derives %s authorization as %s by %s", async (operationType: "REFUND" | "JOB_FUND" | "JOB_SUBMIT" | "JOB_EVALUATE", actionKind: "RELEASE_APPROVAL" | "JOB_SUBMISSION" | "JOB_EVALUATION", actorType: "FOUNDER" | "PROVIDER" | "EVALUATOR") => {
    const fixture = await authorizationFixture();
    const actorId = actorType === "FOUNDER" ? "founder:1" : actorType === "PROVIDER" ? "mock:provider" : "evaluator:1";
    const protocolTarget = operationType === "REFUND" ? fixture.binding.executionIntent.protocolTarget : { kind: "ERC8183" as const, standard: "ERC-8183" as const, network: "ARC_TESTNET" as const, chainId: "synthetic:chain", contractReference: "mock:contract", jobId: "mock:job", method: operationType, parameterCommitment: `sha256:${"a".repeat(64)}`, clientReference: "mock:client", providerReference: "mock:provider", evaluatorReference: "mock:evaluator", destination: fixture.transaction.destinationReference };
    const executionIntent = CanonicalExecutionIntentSchema.parse({ ...fixture.binding.executionIntent, actionKind, operationType, protocolTarget });
    const exactIntentHash = await hashCanonicalExecutionIntent(executionIntent);
    const approval = ApprovalRecordSchema.parse({ ...fixture.approval, actionKind, authorizedActorType: actorType, authorizedActorId: actorId, approver: { actorId, actorType }, exactIntentHash });
    const transaction = TransactionRecordSchema.parse({ ...fixture.transaction, arcTransaction: { ...fixture.transaction.arcTransaction!, operationType, network: protocolTarget.network, chainId: protocolTarget.chainId } });
    await expect(validateExecutionAuthorization(approval, fixture.release, transaction, { ...fixture.binding, exactIntentHash, executionIntent }, context.occurredAt)).resolves.toBe(true);
  });
  it("atomically consumes stored authorization bindings exactly once", async () => {
    const { binding, transaction } = await authorizationFixture(); const repository = new ExecutionAuthorizationBindingRepository();
    const input = structuredClone(binding); repository.create(input); input.exactIntentHash = `sha256:${"f".repeat(64)}`;
    expect(repository.get(binding.id)?.status).toBe("ACTIVE");
    expect(() => repository.consume(binding.id, "transaction:other", context.occurredAt)).toThrow();
    const attempts = await Promise.allSettled([Promise.resolve().then(() => repository.consume(binding.id, transaction.id, context.occurredAt)), Promise.resolve().then(() => repository.consume(binding.id, transaction.id, context.occurredAt))]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1); expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    const stored = repository.get(binding.id)!; expect(stored).toMatchObject({ status: "CONSUMED", consumedByTransactionId: transaction.id }); stored.status = "REVOKED"; expect(repository.get(binding.id)?.status).toBe("CONSUMED");
    const revokedRepository = new ExecutionAuthorizationBindingRepository(); revokedRepository.create({ ...binding, status: "REVOKED" }); expect(() => revokedRepository.consume(binding.id, transaction.id, context.occurredAt)).toThrow();
  });
  it("commits every ERC-8183 protocol target field in canonical hashes", async () => {
    const { binding } = await authorizationFixture();
    const target = { kind: "ERC8183" as const, standard: "ERC-8183" as const, network: "ARC_TESTNET" as const, chainId: "synthetic:chain", contractReference: "mock:contract", jobId: "mock:job", method: "JOB_FUND" as const, parameterCommitment: `sha256:${"a".repeat(64)}`, clientReference: "mock:client", providerReference: "mock:provider", evaluatorReference: "mock:evaluator", destination: "mock:escrow" };
    const intent = { ...binding.executionIntent, actionKind: "RELEASE_APPROVAL" as const, operationType: "JOB_FUND" as const, protocolTarget: target };
    expect(CanonicalExecutionIntentSchema.parse(intent)).toBeDefined();
    expect(() => CanonicalExecutionIntentSchema.parse({ ...intent, protocolTarget: { kind: "ERC8183", standard: "ERC-8183" } })).toThrow();
    expect(() => CanonicalExecutionIntentSchema.parse({ ...binding.executionIntent, protocolTarget: target })).toThrow();
    for (const field of ["network", "chainId", "contractReference", "jobId", "clientReference", "providerReference", "evaluatorReference", "destination"] as const) expect(() => CanonicalExecutionIntentSchema.parse({ ...intent, protocolTarget: { ...target, [field]: "fake" } })).toThrow();
    const original = await hashCanonicalExecutionIntent(intent);
    for (const protocolTarget of [{ ...target, contractReference: "mock:other" }, { ...target, jobId: "mock:other" }, { ...target, method: "JOB_SUBMIT" as const }, { ...target, parameterCommitment: `sha256:${"b".repeat(64)}` }, { ...target, evaluatorReference: "mock:other" }]) expect(await hashCanonicalExecutionIntent({ ...intent, protocolTarget })).not.toBe(original);
  });
  it("validates confirmed release settlement linkage", async () => {
    const { release } = await authorizationFixture(); const confirmedSettlement = SettlementRecordSchema.parse({ id: "settlement:1", projectId: release.projectId, releaseRequestId: release.id, reconciliationId: null, idempotencyKey: "settlement:key", amount: release.amount, state: "CONFIRMED", job: null, transaction: mockTransaction("CONFIRMED"), updatedAt: context.occurredAt }); const confirmedRelease = ReleaseRequestSchema.parse({ ...release, state: "CONFIRMED", settlementId: confirmedSettlement.id });
    expect(validateReleaseConfirmation(confirmedRelease, confirmedSettlement)).toBe(true); expect(() => validateReleaseConfirmation(confirmedRelease, { ...confirmedSettlement, transaction: mockTransaction("SUBMITTED") })).toThrow(); expect(() => validateReleaseConfirmation(confirmedRelease, { ...confirmedSettlement, transaction: mockTransaction("CONFIRMED", "REFUND") })).toThrow(); expect(() => validateReleaseConfirmation(confirmedRelease, { ...confirmedSettlement, transaction: { status: "CONFIRMED", operationType: "SETTLEMENT" } } as never)).toThrow();
  });
  function reconciliationFixture(result: "MATCHED" | "MISMATCH" | "REQUIRES_REVIEW") {
    const matched = result === "MATCHED"; const transaction = TransactionRecordSchema.parse({ id: "transaction:1", projectId: "project:1", releaseRequestId: "release:1", intentId: "intent:1", destinationReference: "mock:recipient", approvalId: "approval:1", approvalBindingId: "binding:1", reconciliationId: matched ? "reconciliation:1" : null, idempotencyKey: "transaction:key", amount: usdc("100"), operationState: matched ? "RECONCILED" : "CONFIRMED", arcTransaction: mockTransaction("CONFIRMED"), createdAt: context.occurredAt, updatedAt: context.occurredAt });
    const settlement = SettlementRecordSchema.parse({ id: "settlement:1", projectId: "project:1", releaseRequestId: "release:1", reconciliationId: matched ? "reconciliation:1" : null, idempotencyKey: "settlement:key", amount: usdc("100"), state: matched ? "RECONCILED" : "CONFIRMED", job: null, transaction: mockTransaction("CONFIRMED"), updatedAt: context.occurredAt });
    const reconciliation = ReconciliationRecordSchema.parse({ id: "reconciliation:1", projectId: "project:1", transactionRecordId: transaction.id, settlementId: settlement.id, result, evidenceReference: "mock:reconciliation-evidence", reconciledAt: context.occurredAt, actor: { actorId: "adapter:authorized", actorType: "ADAPTER" } }); return { transaction, settlement, reconciliation };
  }
  it("accepts MATCHED only for exact amounts and Arc evidence", () => {
    const { transaction, settlement, reconciliation } = reconciliationFixture("MATCHED"); expect(validateReconciliation(transaction, settlement, reconciliation, "adapter:authorized")).toBe(true);
    expect(SettlementRecordSchema.safeParse({ ...settlement, amount: money("EURC", "100") }).success).toBe(false);
    for (const changed of [{ ...settlement, amount: usdc("101") }, { ...settlement, transaction: { ...settlement.transaction!, transactionHash: "mock:different" } }, { ...settlement, transaction: { ...settlement.transaction!, blockHash: "mock:different" } }, { ...settlement, transaction: { ...settlement.transaction!, operationType: "REFUND" as const } }]) expect(() => validateReconciliation(transaction, changed, reconciliation, "adapter:authorized")).toThrow();
  });
  it("parses every reconciliation input before validating matched evidence", () => {
    const { transaction, settlement, reconciliation } = reconciliationFixture("MATCHED");
    expect(validateReconciliation(transaction, settlement, reconciliation, "adapter:authorized")).toBe(true);
    expect(() => validateReconciliation({ ...transaction, arcTransaction: { status: "CONFIRMED", operationType: "SETTLEMENT" } } as unknown as typeof transaction, settlement, reconciliation, "adapter:authorized")).toThrow();
    expect(() => validateReconciliation({ ...transaction, arcTransaction: { ...transaction.arcTransaction!, transactionHash: null } } as unknown as typeof transaction, settlement, reconciliation, "adapter:authorized")).toThrow();
    expect(() => validateReconciliation(transaction, { ...settlement, state: "BROKEN" } as unknown as typeof settlement, reconciliation, "adapter:authorized")).toThrow();
    expect(() => validateReconciliation(transaction, settlement, { ...reconciliation, result: "DONE" } as unknown as typeof reconciliation, "adapter:authorized")).toThrow();
    expect(() => validateReconciliation(transaction, settlement, { ...reconciliation, evidenceReference: "" } as unknown as typeof reconciliation, "adapter:authorized")).toThrow();
    expect(() => validateReconciliation({ ...transaction, amount: { asset: "USDC", atomicUnits: "01" } } as unknown as typeof transaction, settlement, reconciliation, "adapter:authorized")).toThrow();
  });
  it.each(["MISMATCH", "REQUIRES_REVIEW"] as const)("persists %s without advancing lifecycle state", (result: "MISMATCH" | "REQUIRES_REVIEW") => { const value = reconciliationFixture(result); expect(validateReconciliation(value.transaction, value.settlement, value.reconciliation, "adapter:authorized")).toBe(true); expect(() => validateReconciliation({ ...value.transaction, operationState: "RECONCLED", reconciliationId: value.reconciliation.id } as never, value.settlement, value.reconciliation, "adapter:authorized")).toThrow(); });
  it("requires the exact authorized adapter", () => {
    const value = reconciliationFixture("MATCHED"); for (const actorType of ["AI", "SYSTEM", "FOUNDER", "BACKER", "EVALUATOR"] as const) expect(() => validateReconciliation(value.transaction, value.settlement, { ...value.reconciliation, actor: { actorId: "adapter:authorized", actorType } } as never, "adapter:authorized")).toThrow(); expect(() => validateReconciliation(value.transaction, value.settlement, value.reconciliation, "adapter:other")).toThrow(); expect(() => validateReconciliation(value.transaction, value.settlement, value.reconciliation)).toThrow();
  });
  it("rejects lifecycle-only reconciliation", async () => { const { transaction } = await authorizationFixture(); expect(() => TransactionRecordSchema.parse({ ...transaction, operationState: "RECONCILED", arcTransaction: mockTransaction("CONFIRMED"), reconciliationId: null })).toThrow(); });
});

describe("append-only ledger reversal relationships", () => {
  const base = { id: "ledger:1", vaultId: "vault:1", reserveId: null, amount: usdc("1"), idempotencyKey: "ledger:key", occurredAt: context.occurredAt };
  it("requires a distinct target only for reversals", () => {
    expect(() => LedgerEntrySchema.parse({ ...base, kind: "REVERSAL", reversesEntryId: null })).toThrow();
    expect(() => LedgerEntrySchema.parse({ ...base, kind: "CAPITAL", reversesEntryId: "ledger:original" })).toThrow();
    expect(() => LedgerEntrySchema.parse({ ...base, kind: "REVERSAL", reversesEntryId: base.id })).toThrow();
    expect(LedgerEntrySchema.parse({ ...base, kind: "REVERSAL", reversesEntryId: "ledger:original" })).toBeDefined();
  });
  it("validates persisted targets and remaining reversible amount", () => {
    const target = LedgerEntrySchema.parse({ ...base, id: "ledger:original", kind: "CAPITAL", reversesEntryId: null, amount: usdc("10") });
    const reversal = LedgerEntrySchema.parse({
      ...base,
      kind: "REVERSAL",
      reversesEntryId: target.id,
      amount: usdc("6"),
    }) as ReversalEntry;
    expect(validateLedgerReversal(reversal, target)).toBe(true);
    expect(() => validateLedgerReversal(reversal, null)).toThrow();
    expect(() => validateLedgerReversal(reversal, { ...target, vaultId: "vault:other" })).toThrow();
    expect(() => validateLedgerReversal({ ...reversal, amount: usdc("11") }, target)).toThrow();
    const prior: ReversalEntry = {
      ...reversal,
      id: "ledger:prior",
      amount: usdc("10"),
    };
    expect(() => validateLedgerReversal(reversal, target, [prior])).toThrow();
    expect(() => validateLedgerReversal(reversal, target, [{ ...prior, reversesEntryId: "ledger:other" }])).toThrow();
    expect(() => validateLedgerReversal(reversal, target, [{ ...prior, vaultId: "vault:other" }])).toThrow();
    expect(() => validateLedgerReversal({ ...reversal, amount: { asset: "EURC", atomicUnits: "1" } } as never, target)).toThrow();
  });
});

describe("discriminated milestone requirements", () => {
  const base = { id: "requirement:1", milestoneId: "milestone:1", description: "Requirement" };
  it("requires kind-specific parameters", () => {
    expect(() => MilestoneRequirementSchema.parse({ ...base, kind: "SPEND_LIMIT" })).toThrow();
    expect(() => MilestoneRequirementSchema.parse({ ...base, kind: "EXPENSE_RECORDS" })).toThrow();
    expect(MilestoneRequirementSchema.parse({ ...base, kind: "SPEND_LIMIT", spendLimit: usdc("1") })).toBeDefined();
    for (const asset of ["EURC", "ETH", "TOKEN"]) expect(() => MilestoneRequirementSchema.parse({ ...base, kind: "SPEND_LIMIT", spendLimit: money(asset, "1") })).toThrow();
    expect(MilestoneRequirementSchema.parse({ ...base, kind: "EXPENSE_RECORDS", requiredCount: 2 })).toBeDefined();
  });
  it("rejects parameters belonging to another kind", () => {
    expect(() => MilestoneRequirementSchema.parse({ ...base, kind: "DELIVERABLE", spendLimit: usdc("1") })).toThrow();
    expect(() => MilestoneRequirementSchema.parse({ ...base, kind: "FOUNDER_CONFIRMATION", requiredCount: 1 })).toThrow();
    expect(() => MilestoneRequirementSchema.parse({ ...base, kind: "EXPENSE_RECORDS", requiredCount: 2, spendLimit: usdc("1") })).toThrow();
  });
});

describe("Backer-safe disclosure filtering", () => {
  it("allowlists approved disclosures and excludes every founder-private value", () => {
    const seed = createPawPovAiSeed(); const secret = "DO-NOT-DISCLOSE";
    const evidence = EvidenceItemSchema.parse({ id: "evidence:private", projectId: seed.project.id, kind: "RECEIPT", sourceHash: `sha256:${"b".repeat(64)}`, storageRef: `private://${secret}`, visibility: "FOUNDER_PRIVATE", submittedAt: context.occurredAt, rawContent: secret, privateNotes: secret });
    const proofs = [{ id: "proof:approved", projectId: seed.project.id, milestoneId: seed.milestone.id, version: 1, approvedEvidenceHashes: [evidence.sourceHash], recordHash: `sha256:${"c".repeat(64)}`, visibility: "BACKER_SHARED" as const, createdAt: context.occurredAt }, { id: "proof:hidden", projectId: seed.project.id, milestoneId: seed.milestone.id, version: 1, approvedEvidenceHashes: [], recordHash: `sha256:${"d".repeat(64)}`, visibility: "FOUNDER_PRIVATE" as const, createdAt: context.occurredAt }, { id: "proof:other", projectId: "project:other", milestoneId: "milestone:other", version: 99, approvedEvidenceHashes: [], recordHash: `sha256:${"e".repeat(64)}`, visibility: "BACKER_SHARED" as const, createdAt: context.occurredAt }];
    const result = filterBackerDisclosure({ project: seed.project, evidence: [evidence], proofs, settlements: [{ id: "settlement:private", projectId: seed.project.id, releaseRequestId: "release:1", reconciliationId: null, idempotencyKey: "settlement:key", amount: usdc("1"), state: "PENDING", job: null, transaction: null, updatedAt: context.occurredAt }], preferences: { ...seed.disclosurePreferences, discloseProofRecords: true, approvedProofIds: ["proof:approved", "proof:hidden", "proof:other"], discloseSettlementState: false } });
    expect(result.proofs.map((proof) => proof.id)).toEqual(["proof:approved"]); expect(result.settlements).toEqual([]); expect(result.evidence).toEqual([]);
    const serialized = JSON.stringify(result); expect(serialized).not.toContain(secret); expect(serialized).not.toContain("storageRef"); expect(serialized).not.toContain("privateNotes"); expect(serialized).not.toContain("proof:hidden"); expect(serialized).not.toContain("proof:other"); expect(serialized).not.toContain("milestone:other"); expect(serialized).not.toContain("settlement:private");
  });
  it("parses every proof and discloses only explicitly approved public records", () => {
    const seed = createPawPovAiSeed();
    const proof = { id: "proof:shared", projectId: seed.project.id, milestoneId: seed.milestone.id, version: 1, approvedEvidenceHashes: [], recordHash: `sha256:${"a".repeat(64)}`, visibility: "BACKER_SHARED" as const, createdAt: context.occurredAt };
    const publicProof = { ...proof, id: "proof:public", visibility: "ONCHAIN_PUBLIC" as const };
    const hidden = { ...proof, id: "proof:hidden", visibility: "FOUNDER_PRIVATE" as const };
    const unapproved = { ...proof, id: "proof:unapproved" };
    const other = { ...proof, id: "proof:other", projectId: "project:other" };
    const preferences = { ...seed.disclosurePreferences, discloseProofRecords: true, approvedProofIds: [proof.id, publicProof.id, hidden.id, other.id] };
    const result = filterBackerDisclosure({ project: seed.project, evidence: [], proofs: [proof, publicProof, hidden, unapproved, other], settlements: [], preferences });
    expect(result.proofs.map(({ id }) => id)).toEqual([proof.id, publicProof.id]);
    for (const malformed of [{ ...proof, visibility: undefined }, { ...proof, visibility: "ARBITRARY" }, { ...proof, recordHash: "bad" }, { ...proof, version: 0 }]) expect(() => filterBackerDisclosure({ project: seed.project, evidence: [], proofs: [malformed] as never, settlements: [], preferences })).toThrow();
  });
  it("revalidates all settlements and discloses only the selected project", () => {
    const seed = createPawPovAiSeed(); const settlement = { releaseRequestId: "release:1", reconciliationId: null, idempotencyKey: "settlement:key", amount: usdc("1"), state: "PENDING" as const, job: null, transaction: null, updatedAt: context.occurredAt };
    const result = filterBackerDisclosure({ project: seed.project, evidence: [], proofs: [], settlements: [{ ...settlement, id: "settlement:selected", projectId: seed.project.id }, { ...settlement, id: "settlement:other", projectId: "project:other" }], preferences: { ...seed.disclosurePreferences, discloseSettlementState: true } });
    expect(result.settlements.map((record) => record.id)).toEqual(["settlement:selected"]);
    expect(() => filterBackerDisclosure({ project: seed.project, evidence: [], proofs: [], settlements: [{ ...settlement, id: "settlement:invalid-other", projectId: "project:other", state: "CONFIRMED" }], preferences: { ...seed.disclosurePreferences, discloseSettlementState: false } })).toThrow();
  });
  it("fails closed on malformed disclosure preferences", () => {
    const seed = createPawPovAiSeed();
    expect(() => filterBackerDisclosure({ project: seed.project, evidence: [], proofs: [], settlements: [], preferences: { ...seed.disclosurePreferences, discloseSettlementState: "false" } as never })).toThrow();
  });
});

describe("PawPOVAI seed", () => {
  it("is reproducible and allocates exactly 1,000 test USDC", () => {
    const first = createPawPovAiSeed(); const second = createPawPovAiSeed(); expect(first).toEqual(second); expect(first).not.toBe(second);
    expect(first.reserves.reduce((total, reserve) => total + BigInt(reserve.allocated.atomicUnits), 0n).toString()).toBe("1000000000");
    expect(first.vault.totalCapital.atomicUnits).toBe("1000000000"); expect(first.milestone.proposedAmount.atomicUnits).toBe("250000000");
    expect(first.requirements).toHaveLength(6); expect(first.disclosurePreferences.discloseProofRecords).toBe(false);
    expect(LaunchVaultSchema.parse(first.vault)).toEqual(first.vault); first.requirements.forEach((requirement) => expect(MilestoneRequirementSchema.parse(requirement)).toEqual(requirement));
  });
  it("rejects a vault whose declared asset differs from its total capital", () => { const seed = createPawPovAiSeed(); expect(() => LaunchVaultSchema.parse({ ...seed.vault, asset: "EURC" })).toThrow(); });
  it.each(["EURC", "ETH", "TOKEN"])("rejects %s milestone proposal amounts", (asset: string) => { const seed = createPawPovAiSeed(); expect(() => MilestoneSchema.parse({ ...seed.milestone, proposedAmount: money(asset, "1") })).toThrow(); });
});
