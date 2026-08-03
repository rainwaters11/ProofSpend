import { describe, expect, it } from "vitest";
import {
  addMoney, AgenticJobRefSchema, AgenticJobStatusSchema, AgentIdentityRefSchema, AgentReputationRefSchema,
  ARC_TESTNET_CHAIN_ID, arcTestnetExplorerTransactionUrl,
  AllocationOperationRecordSchema, ApprovalRecordSchema, ArcTransactionRefSchema, compareMoney,
  createPawPovAiSeed, EvidenceItemSchema, filterBackerDisclosure, IdempotencyConflictError, InMemoryAuditRepository,
  InMemoryIdempotencyRepository, InMemoryRepository, InvalidTransitionError, LaunchVaultSchema, mapAgenticJobToApplication,
  MilestoneRequirementSchema,
  MockAgenticJobAdapter, MockIdentityAdapter, MockWalletReferenceAdapter, money, MoneyAmountSchema, MoneyError,
  RecoveryOperationRecordSchema, ReleaseRequestSchema, SettlementRecordSchema, SubmissionOperationRecordSchema, subtractMoney,
  TransactionRecordSchema, transitionAgenticJob, transitionApplication,
} from "../src";

const context = { aggregateType: "milestone", aggregateId: "m1", eventId: "event:1", occurredAt: "2026-01-01T00:00:00.000Z", actor: { actorId: "system", actorType: "SYSTEM" as const } };
const mockTransaction = (status: "NONE" | "PREPARED" | "SUBMITTED" | "CONFIRMED" | "FAILED", operationType: "SETTLEMENT" | "REFUND" = "SETTLEMENT") => ({
  network: "ARC_TESTNET" as const, chainId: "synthetic:chain", transactionHash: status === "SUBMITTED" || status === "CONFIRMED" ? "mock:transaction" : null,
  status, blockNumber: status === "CONFIRMED" ? "1" : null, blockHash: status === "CONFIRMED" ? "mock:block" : null,
  explorerUrl: null, operationType, isMock: true,
});
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
  it("supports only explicit job transitions and never maps eligibility to completion", () => {
    expect(transitionAgenticJob("OPEN", "FUNDED", { ...context, actor: { actorId: "adapter", actorType: "ADAPTER" }, authorizedAdapterId: "adapter" }).status).toBe("FUNDED");
    expect(() => transitionAgenticJob("OPEN", "COMPLETED", context)).toThrow(InvalidTransitionError);
    expect(mapAgenticJobToApplication("OPEN")).toBeNull();
    expect(mapAgenticJobToApplication("COMPLETED")).toBeNull();
  });
  it.each(["FOUNDER", "EVALUATOR"] as const)("allows an explicitly authorized %s to approve", (actorType) => {
    const actor = { actorId: `authorized:${actorType}`, actorType };
    expect(transitionApplication("APPROVAL_PENDING", "APPROVED", { ...context, actor, authorizedApproverId: actor.actorId }).state).toBe("APPROVED");
  });
  it.each(["AI", "SYSTEM", "BACKER", "ADAPTER"] as const)("rejects %s approval without emitting a successful result", (actorType) => {
    expect(() => transitionApplication("APPROVAL_PENDING", "APPROVED", { ...context, actor: { actorId: "forbidden", actorType }, authorizedApproverId: "forbidden" })).toThrow(InvalidTransitionError);
  });
  it("requires the explicitly authorized adapter to submit", () => {
    expect(transitionApplication("PREPARED", "SUBMITTED", { ...context, actor: { actorId: "adapter:authorized", actorType: "ADAPTER" }, authorizedAdapterId: "adapter:authorized" }).state).toBe("SUBMITTED");
    expect(() => transitionApplication("PREPARED", "SUBMITTED", { ...context, actor: { actorId: "adapter:other", actorType: "ADAPTER" }, authorizedAdapterId: "adapter:authorized" })).toThrow(InvalidTransitionError);
  });
  it.each([
    ["INCOMPLETE", "NEEDS_REVIEW", "SYSTEM", "authorizedSystemId"], ["NEEDS_REVIEW", "INCOMPLETE", "SYSTEM", "authorizedSystemId"],
    ["NEEDS_REVIEW", "ELIGIBLE", "SYSTEM", "authorizedSystemId"], ["NEEDS_REVIEW", "REJECTED", "SYSTEM", "authorizedSystemId"],
    ["ELIGIBLE", "APPROVAL_PENDING", "SYSTEM", "authorizedSystemId"], ["APPROVAL_PENDING", "APPROVED", "FOUNDER", "authorizedApproverId"],
    ["APPROVAL_PENDING", "REJECTED", "EVALUATOR", "authorizedApproverId"], ["APPROVED", "PREPARED", "ADAPTER", "authorizedAdapterId"],
    ["PREPARED", "SUBMITTED", "ADAPTER", "authorizedAdapterId"], ["PREPARED", "FAILED", "ADAPTER", "authorizedAdapterId"],
    ["SUBMITTED", "CONFIRMED", "ADAPTER", "authorizedAdapterId"], ["SUBMITTED", "FAILED", "ADAPTER", "authorizedAdapterId"],
    ["CONFIRMED", "RECONCILED", "ADAPTER", "authorizedAdapterId"],
  ] as const)("authorizes the complete %s -> %s matrix", (from, to, actorType, identifier) => {
    const actor = { actorId: "authorized", actorType }; const authorized = { [identifier]: actor.actorId };
    expect(transitionApplication(from, to, { ...context, actor, ...authorized }).state).toBe(to);
    expect(() => transitionApplication(from, to, { ...context, actor: { ...actor, actorId: "wrong" }, ...authorized })).toThrow(InvalidTransitionError);
    expect(() => transitionApplication(from, to, { ...context, actor })).toThrow(InvalidTransitionError);
  });
  it("requires the exact authorized evaluator for terminal job decisions", () => {
    expect(transitionAgenticJob("SUBMITTED", "COMPLETED", { ...context, actor: { actorId: "evaluator:1", actorType: "EVALUATOR" }, authorizedEvaluatorId: "evaluator:1" }).status).toBe("COMPLETED");
    expect(() => transitionAgenticJob("SUBMITTED", "REJECTED", { ...context, actor: { actorId: "evaluator:other", actorType: "EVALUATOR" }, authorizedEvaluatorId: "evaluator:1" })).toThrow(InvalidTransitionError);
  });
  it.each([
    ["OPEN", "FUNDED", "ADAPTER", "authorizedAdapterId"], ["FUNDED", "SUBMITTED", "ADAPTER", "authorizedAdapterId"],
    ["SUBMITTED", "COMPLETED", "EVALUATOR", "authorizedEvaluatorId"], ["SUBMITTED", "REJECTED", "EVALUATOR", "authorizedEvaluatorId"],
    ["OPEN", "EXPIRED", "SYSTEM", "authorizedSystemId"], ["FUNDED", "EXPIRED", "SYSTEM", "authorizedSystemId"], ["SUBMITTED", "EXPIRED", "SYSTEM", "authorizedSystemId"],
  ] as const)("authorizes the complete job %s -> %s matrix", (from, to, actorType, identifier) => {
    const actor = { actorId: "authorized", actorType }; const authorized = { [identifier]: actor.actorId };
    expect(transitionAgenticJob(from, to, { ...context, actor, ...authorized }).status).toBe(to);
    expect(() => transitionAgenticJob(from, to, { ...context, actor: { ...actor, actorId: "wrong" }, ...authorized })).toThrow(InvalidTransitionError);
    expect(() => transitionAgenticJob(from, to, { ...context, actor })).toThrow(InvalidTransitionError);
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
    ["allocation", AllocationOperationRecordSchema, { id: "allocation:1", reserveId: "reserve:1", idempotencyKey: "allocation:key", amount: money("USDC", "1"), createdAt: context.occurredAt }],
    ["approval", ApprovalRecordSchema, { id: "approval:1", actionType: "RELEASE", exactIntentHash: `sha256:${"a".repeat(64)}`, idempotencyKey: "approval:key", decision: "PENDING", approver: null, expiresAt: context.occurredAt, decidedAt: null }],
    ["submission", SubmissionOperationRecordSchema, { id: "submission:1", transactionId: "transaction:1", idempotencyKey: "submission:key", createdAt: context.occurredAt }],
    ["settlement", SettlementRecordSchema, { id: "settlement:1", projectId: "project:1", releaseRequestId: "release:1", idempotencyKey: "settlement:key", amount: money("USDC", "1"), state: "PENDING", job: null, transaction: null, updatedAt: context.occurredAt }],
    ["recovery", RecoveryOperationRecordSchema, { id: "recovery:1", proofGapId: "gap:1", idempotencyKey: "recovery:key", responseReference: "private:response:1", createdAt: context.occurredAt }],
  ])("directly models and deduplicates %s operations", async (scope, schema, record) => {
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
    expect(() => TransactionRecordSchema.parse({ id: "tx:1", intentId: "intent:1", idempotencyKey: "tx:key", amount: money("USDC", "1"), operationState: "CONFIRMED", arcTransaction: null, createdAt: context.occurredAt, updatedAt: context.occurredAt })).toThrow();
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
    expect(result.success).toBe(false); if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes("deferred to Issue #13"))).toBe(true);
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
  it("transitions only mock jobs without contract behavior", () => {
    const job = { standard: "ERC-8183" as const, network: "synthetic:arc-testnet", chainId: "synthetic:chain", contractAddress: "mock:not-a-contract", jobId: "mock:job", clientAddress: "mock:client", providerAddress: "mock:provider", evaluatorAddress: "mock:evaluator", budget: money("USDC", "250000000"), expiresAt: "2026-02-01T00:00:00.000Z", descriptionReference: "mock:description", deliverableReference: null, reasonReference: null, status: "OPEN" as const, transaction: null, isMock: true };
    expect(AgenticJobRefSchema.parse(job)).toEqual(job);
    expect(new MockAgenticJobAdapter().transition(job, "FUNDED", { ...context, actor: { actorId: "adapter", actorType: "ADAPTER" }, authorizedAdapterId: "adapter" }).job.status).toBe("FUNDED"); expect(job.status).toBe("OPEN");
  });
  it("requires every protocol-reference field", () => {
    const identity = new MockIdentityAdapter().getIdentity(); const { metadataVersion: _metadataVersion, ...missingIdentity } = identity;
    expect(() => AgentIdentityRefSchema.parse(missingIdentity)).toThrow();
    expect(() => AgentReputationRefSchema.parse({ standard: "ERC-8004", network: "mock:network", chainId: "mock:chain", registryAddress: "mock:registry", agentId: "mock:agent", writerAddress: "mock:writer", agentOwnerAddress: "mock:owner", eventReference: "mock:event", score: null, tag: null, recordedAt: null, isMock: true })).toThrow();
    expect(() => ArcTransactionRefSchema.parse({ network: "ARC_TESTNET", chainId: "synthetic:chain", transactionHash: null, status: "PREPARED", blockNumber: null, blockHash: null, explorerUrl: null, isMock: true })).toThrow();
    expect(() => AgenticJobRefSchema.parse({ standard: "ERC-8183", network: "mock:network", chainId: "mock:chain", contractAddress: "mock:contract", jobId: "mock:job", clientAddress: "mock:client", providerAddress: "mock:provider", evaluatorAddress: "mock:evaluator", status: "OPEN", transaction: null, isMock: true })).toThrow();
  });
  it("requires valid live EVM reputation actors and rejects canonical self-writing", () => {
    const base = { standard: "ERC-8004" as const, network: "ARC_TESTNET", chainId: "5042002", registryAddress: "registry", agentId: "1", eventReference: "event:1", score: 1, tag: null, recordedAt: context.occurredAt, isMock: false };
    expect(AgentReputationRefSchema.parse({ ...base, writerAddress: "0x1111111111111111111111111111111111111111", agentOwnerAddress: "0x2222222222222222222222222222222222222222" })).toBeDefined();
    expect(() => AgentReputationRefSchema.parse({ ...base, writerAddress: "not-an-address", agentOwnerAddress: "0x2222222222222222222222222222222222222222" })).toThrow();
    expect(() => AgentReputationRefSchema.parse({ ...base, writerAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", agentOwnerAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).toThrow();
  });
});

describe("lifecycle evidence schemas", () => {
  it("requires authorized completed approvals and empty pending decisions", () => {
    const base = { id: "approval:1", actionType: "RELEASE", exactIntentHash: `sha256:${"e".repeat(64)}`, idempotencyKey: "approval:key", expiresAt: context.occurredAt };
    expect(ApprovalRecordSchema.parse({ ...base, decision: "APPROVED", approver: { actorId: "founder:1", actorType: "FOUNDER" }, decidedAt: context.occurredAt })).toBeDefined();
    expect(ApprovalRecordSchema.parse({ ...base, decision: "REJECTED", approver: { actorId: "evaluator:1", actorType: "EVALUATOR" }, decidedAt: context.occurredAt })).toBeDefined();
    expect(() => ApprovalRecordSchema.parse({ ...base, decision: "APPROVED", approver: { actorId: "ai:1", actorType: "AI" }, decidedAt: context.occurredAt })).toThrow();
    expect(() => ApprovalRecordSchema.parse({ ...base, decision: "PENDING", approver: { actorId: "founder:1", actorType: "FOUNDER" }, decidedAt: context.occurredAt })).toThrow();
  });
  it("requires persisted approvals only in approved-or-later release states", () => {
    const base = { id: "release:1", milestoneId: "milestone:1", proofId: "proof:1", amount: money("USDC", "1"), idempotencyKey: "release:key", createdAt: context.occurredAt };
    expect(() => ReleaseRequestSchema.parse({ ...base, state: "APPROVED", approvalId: null })).toThrow();
    expect(() => ReleaseRequestSchema.parse({ ...base, state: "DRAFT", approvalId: "approval:1" })).toThrow();
    expect(ReleaseRequestSchema.parse({ ...base, state: "SUBMITTED", approvalId: "approval:1" })).toBeDefined();
  });
  it("enforces transaction operation-state parity", () => {
    const base = { id: "transaction:1", intentId: "intent:1", idempotencyKey: "transaction:key", amount: money("USDC", "1"), createdAt: context.occurredAt, updatedAt: context.occurredAt };
    expect(() => TransactionRecordSchema.parse({ ...base, operationState: "SUBMITTED", arcTransaction: null })).toThrow();
    expect(() => TransactionRecordSchema.parse({ ...base, operationState: "SUBMITTED", arcTransaction: mockTransaction("PREPARED") })).toThrow();
    expect(TransactionRecordSchema.parse({ ...base, operationState: "SUBMITTED", arcTransaction: mockTransaction("SUBMITTED") })).toBeDefined();
    expect(TransactionRecordSchema.parse({ ...base, operationState: "RECONCILED", arcTransaction: mockTransaction("CONFIRMED") })).toBeDefined();
    expect(() => TransactionRecordSchema.parse({ ...base, operationState: "FAILED", arcTransaction: mockTransaction("CONFIRMED") })).toThrow();
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
  });
  it("requires truthful settlement, refund, and reconciliation evidence", () => {
    const base = { id: "settlement:1", projectId: "project:1", releaseRequestId: "release:1", idempotencyKey: "settlement:key", amount: money("USDC", "1"), job: null, updatedAt: context.occurredAt };
    expect(() => SettlementRecordSchema.parse({ ...base, state: "CONFIRMED", transaction: null })).toThrow();
    expect(() => SettlementRecordSchema.parse({ ...base, state: "CONFIRMED", transaction: mockTransaction("SUBMITTED") })).toThrow();
    expect(SettlementRecordSchema.parse({ ...base, state: "CONFIRMED", transaction: mockTransaction("CONFIRMED") })).toBeDefined();
    expect(() => SettlementRecordSchema.parse({ ...base, state: "REFUNDED", transaction: mockTransaction("CONFIRMED") })).toThrow();
    expect(SettlementRecordSchema.parse({ ...base, state: "REFUNDED", transaction: mockTransaction("CONFIRMED", "REFUND") })).toBeDefined();
    expect(() => SettlementRecordSchema.parse({ ...base, state: "RECONCILED", transaction: null })).toThrow();
    const completedJob = { standard: "ERC-8183" as const, network: "synthetic:arc-testnet", chainId: "synthetic:chain", contractAddress: "mock:contract", jobId: "mock:job", clientAddress: "mock:client", providerAddress: "mock:provider", evaluatorAddress: "mock:evaluator", budget: money("USDC", "1"), expiresAt: "2026-02-01T00:00:00.000Z", descriptionReference: "mock:description", deliverableReference: "mock:deliverable", reasonReference: null, status: "COMPLETED" as const, transaction: null, isMock: true };
    expect(() => SettlementRecordSchema.parse({ ...base, state: "CONFIRMED", job: completedJob, transaction: null })).toThrow();
  });
  it.each([
    ["PENDING", null, true], ["PENDING", mockTransaction("PREPARED"), true], ["PENDING", mockTransaction("SUBMITTED"), true], ["PENDING", mockTransaction("CONFIRMED"), false],
    ["CONFIRMED", mockTransaction("CONFIRMED"), true], ["CONFIRMED", null, false],
    ["REFUND_PENDING", null, true], ["REFUND_PENDING", mockTransaction("PREPARED", "REFUND"), true], ["REFUND_PENDING", mockTransaction("SUBMITTED", "REFUND"), true], ["REFUND_PENDING", mockTransaction("SUBMITTED"), false],
    ["REFUNDED", mockTransaction("CONFIRMED", "REFUND"), true], ["REFUNDED", mockTransaction("CONFIRMED"), false],
    ["RECONCILED", mockTransaction("CONFIRMED"), true], ["RECONCILED", mockTransaction("CONFIRMED", "REFUND"), true], ["RECONCILED", mockTransaction("SUBMITTED"), false],
    ["FAILED", null, true], ["FAILED", mockTransaction("FAILED"), true], ["FAILED", mockTransaction("CONFIRMED"), false],
  ] as const)("validates %s settlement evidence", (state, transaction, valid) => {
    const candidate = { id: "settlement:matrix", projectId: "project:1", releaseRequestId: "release:1", idempotencyKey: "settlement:key", amount: money("USDC", "1"), state, job: null, transaction, updatedAt: context.occurredAt };
    expect(SettlementRecordSchema.safeParse(candidate).success).toBe(valid);
  });
  it("rejects unsupported confirmed settlement disclosure", () => {
    const seed = createPawPovAiSeed();
    expect(() => filterBackerDisclosure({ project: seed.project, evidence: [], proofs: [], settlements: [{ id: "settlement:bad", projectId: seed.project.id, releaseRequestId: "release:1", idempotencyKey: "settlement:key", amount: money("USDC", "1"), state: "CONFIRMED", job: null, transaction: null, updatedAt: context.occurredAt }], preferences: { ...seed.disclosurePreferences, discloseSettlementState: true } })).toThrow();
  });
});

describe("discriminated milestone requirements", () => {
  const base = { id: "requirement:1", milestoneId: "milestone:1", description: "Requirement" };
  it("requires kind-specific parameters", () => {
    expect(() => MilestoneRequirementSchema.parse({ ...base, kind: "SPEND_LIMIT" })).toThrow();
    expect(() => MilestoneRequirementSchema.parse({ ...base, kind: "EXPENSE_RECORDS" })).toThrow();
    expect(MilestoneRequirementSchema.parse({ ...base, kind: "SPEND_LIMIT", spendLimit: money("USDC", "1") })).toBeDefined();
    expect(MilestoneRequirementSchema.parse({ ...base, kind: "EXPENSE_RECORDS", requiredCount: 2 })).toBeDefined();
  });
  it("rejects parameters belonging to another kind", () => {
    expect(() => MilestoneRequirementSchema.parse({ ...base, kind: "DELIVERABLE", spendLimit: money("USDC", "1") })).toThrow();
    expect(() => MilestoneRequirementSchema.parse({ ...base, kind: "FOUNDER_CONFIRMATION", requiredCount: 1 })).toThrow();
    expect(() => MilestoneRequirementSchema.parse({ ...base, kind: "EXPENSE_RECORDS", requiredCount: 2, spendLimit: money("USDC", "1") })).toThrow();
  });
});

describe("Backer-safe disclosure filtering", () => {
  it("allowlists approved disclosures and excludes every founder-private value", () => {
    const seed = createPawPovAiSeed(); const secret = "DO-NOT-DISCLOSE";
    const evidence = EvidenceItemSchema.parse({ id: "evidence:private", projectId: seed.project.id, kind: "RECEIPT", sourceHash: `sha256:${"b".repeat(64)}`, storageRef: `private://${secret}`, visibility: "FOUNDER_PRIVATE", submittedAt: context.occurredAt, rawContent: secret, privateNotes: secret });
    const proofs = [{ id: "proof:approved", milestoneId: seed.milestone.id, version: 1, approvedEvidenceHashes: [evidence.sourceHash], recordHash: `sha256:${"c".repeat(64)}`, visibility: "BACKER_SHARED" as const, createdAt: context.occurredAt }, { id: "proof:hidden", milestoneId: seed.milestone.id, version: 1, approvedEvidenceHashes: [], recordHash: `sha256:${"d".repeat(64)}`, visibility: "FOUNDER_PRIVATE" as const, createdAt: context.occurredAt }];
    const result = filterBackerDisclosure({ project: seed.project, evidence: [evidence], proofs, settlements: [{ id: "settlement:private", projectId: seed.project.id, releaseRequestId: "release:1", idempotencyKey: "settlement:key", amount: money("USDC", "1"), state: "PENDING", job: null, transaction: null, updatedAt: context.occurredAt }], preferences: { ...seed.disclosurePreferences, discloseProofRecords: true, approvedProofIds: ["proof:approved", "proof:hidden"], discloseSettlementState: false } });
    expect(result.proofs.map((proof) => proof.id)).toEqual(["proof:approved"]); expect(result.settlements).toEqual([]); expect(result.evidence).toEqual([]);
    const serialized = JSON.stringify(result); expect(serialized).not.toContain(secret); expect(serialized).not.toContain("storageRef"); expect(serialized).not.toContain("privateNotes"); expect(serialized).not.toContain("proof:hidden"); expect(serialized).not.toContain("settlement:private");
  });
  it("revalidates all settlements and discloses only the selected project", () => {
    const seed = createPawPovAiSeed(); const settlement = { releaseRequestId: "release:1", idempotencyKey: "settlement:key", amount: money("USDC", "1"), state: "PENDING" as const, job: null, transaction: null, updatedAt: context.occurredAt };
    const result = filterBackerDisclosure({ project: seed.project, evidence: [], proofs: [], settlements: [{ ...settlement, id: "settlement:selected", projectId: seed.project.id }, { ...settlement, id: "settlement:other", projectId: "project:other" }], preferences: { ...seed.disclosurePreferences, discloseSettlementState: true } });
    expect(result.settlements.map((record) => record.id)).toEqual(["settlement:selected"]);
    expect(() => filterBackerDisclosure({ project: seed.project, evidence: [], proofs: [], settlements: [{ ...settlement, id: "settlement:invalid-other", projectId: "project:other", state: "CONFIRMED" }], preferences: { ...seed.disclosurePreferences, discloseSettlementState: false } })).toThrow();
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
});
