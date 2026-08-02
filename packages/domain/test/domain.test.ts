import { describe, expect, it } from "vitest";
import {
  addMoney, AgenticJobRefSchema, AgenticJobStatusSchema, AgentIdentityRefSchema, AgentReputationRefSchema,
  AllocationOperationRecordSchema, ApprovalRecordSchema, ArcTransactionRefSchema, compareMoney,
  createPawPovAiSeed, EvidenceItemSchema, filterBackerDisclosure, IdempotencyConflictError, InMemoryAuditRepository,
  InMemoryIdempotencyRepository, InMemoryRepository, InvalidTransitionError, LaunchVaultSchema, mapAgenticJobToApplication,
  MockAgenticJobAdapter, MockIdentityAdapter, MockWalletReferenceAdapter, money, MoneyAmountSchema, MoneyError,
  RecoveryOperationRecordSchema, SettlementRecordSchema, SubmissionOperationRecordSchema, subtractMoney,
  TransactionRecordSchema, transitionAgenticJob, transitionApplication, UnauthorizedTransitionActorError,
} from "../src";

const context = { aggregateType: "milestone", aggregateId: "m1", eventId: "event:1", occurredAt: "2026-01-01T00:00:00.000Z", actor: { actorId: "system", actorType: "SYSTEM" as const } };
const evaluatorContext = { ...context, actor: { actorId: "evaluator:1", actorType: "EVALUATOR" as const }, authorizedEvaluatorId: "evaluator:1" };

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
    expect(transitionApplication("NEEDS_REVIEW", "ELIGIBLE", context)).toMatchObject({ state: "ELIGIBLE", auditEvent: { eventType: "STATE_TRANSITIONED", details: { from: "NEEDS_REVIEW", to: "ELIGIBLE" } } });
  });
  it("does not mutate state or emit an event for an invalid transition", () => {
    const record = Object.freeze({ state: "ELIGIBLE" as const });
    expect(() => transitionApplication(record.state, "CONFIRMED", context)).toThrow(InvalidTransitionError);
    expect(record).toEqual({ state: "ELIGIBLE" });
  });
  it("supports only explicit job transitions and never maps eligibility to completion", () => {
    expect(transitionAgenticJob("OPEN", "FUNDED", context).status).toBe("FUNDED");
    expect(() => transitionAgenticJob("OPEN", "COMPLETED", context)).toThrow(InvalidTransitionError);
    expect(mapAgenticJobToApplication("OPEN")).toBeNull();
    expect(mapAgenticJobToApplication("COMPLETED")).toBe("CONFIRMED");
  });
  it("allows only the exact authorized evaluator to finalize a submitted job", () => {
    expect(transitionAgenticJob("SUBMITTED", "COMPLETED", evaluatorContext).status).toBe("COMPLETED");
    expect(transitionAgenticJob("SUBMITTED", "REJECTED", evaluatorContext).status).toBe("REJECTED");
    expect(() => transitionAgenticJob("SUBMITTED", "COMPLETED", { ...context, actor: { actorId: "ai:1", actorType: "AI" as const }, authorizedEvaluatorId: "ai:1" })).toThrow(UnauthorizedTransitionActorError);
    expect(() => transitionAgenticJob("SUBMITTED", "COMPLETED", { ...context, actor: { actorId: "founder:1", actorType: "FOUNDER" as const }, authorizedEvaluatorId: "founder:1" })).toThrow(UnauthorizedTransitionActorError);
    expect(() => transitionAgenticJob("SUBMITTED", "COMPLETED", { ...context, actor: { actorId: "evaluator:2", actorType: "EVALUATOR" as const }, authorizedEvaluatorId: "evaluator:1" })).toThrow(UnauthorizedTransitionActorError);
    expect(() => transitionAgenticJob("SUBMITTED", "COMPLETED", { ...context, actor: { actorId: "evaluator:1", actorType: "EVALUATOR" as const } })).toThrow(UnauthorizedTransitionActorError);
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
    const repository = new InMemoryAuditRepository(); const audit = transitionApplication("INCOMPLETE", "NEEDS_REVIEW", context).auditEvent;
    repository.append(audit); const output = repository.list(); output[0]!.details.to = "tampered";
    expect(repository.list()[0]!.details.to).toBe("NEEDS_REVIEW");
    expect("update" in repository).toBe(false); expect("delete" in repository).toBe(false);
  });
  it("returns the original idempotent result and rejects conflicting reuse", () => {
    const repository = new InMemoryIdempotencyRepository(); let executions = 0;
    const action = () => ({ id: `result:${++executions}` });
    expect(repository.execute("release", "key", "fingerprint", action)).toEqual({ id: "result:1" });
    expect(repository.execute("release", "key", "fingerprint", action)).toEqual({ id: "result:1" });
    expect(executions).toBe(1);
    expect(() => repository.execute("release", "key", "different", action)).toThrow(IdempotencyConflictError);
  });
  it("avoids scope and key tuple collisions", () => {
    const repository = new InMemoryIdempotencyRepository();
    expect(repository.execute("a:b", "c", "fingerprint:1", () => ({ id: "first" }))).toEqual({ id: "first" });
    expect(repository.execute("a", "b:c", "fingerprint:2", () => ({ id: "second" }))).toEqual({ id: "second" });
  });
  it.each([
    ["allocation", AllocationOperationRecordSchema, { id: "allocation:1", reserveId: "reserve:1", idempotencyKey: "allocation:key", amount: money("USDC", "1"), createdAt: context.occurredAt }],
    ["approval", ApprovalRecordSchema, { id: "approval:1", actionType: "RELEASE", exactIntentHash: `sha256:${"a".repeat(64)}`, idempotencyKey: "approval:key", decision: "PENDING", approver: null, expiresAt: context.occurredAt, decidedAt: null }],
    ["submission", SubmissionOperationRecordSchema, { id: "submission:1", transactionId: "transaction:1", idempotencyKey: "submission:key", createdAt: context.occurredAt }],
    ["settlement", SettlementRecordSchema, { id: "settlement:1", releaseRequestId: "release:1", idempotencyKey: "settlement:key", amount: money("USDC", "1"), state: "PENDING", job: null, transaction: null, updatedAt: context.occurredAt }],
    ["recovery", RecoveryOperationRecordSchema, { id: "recovery:1", proofGapId: "gap:1", idempotencyKey: "recovery:key", responseReference: "private:response:1", createdAt: context.occurredAt }],
  ])("directly models and deduplicates %s operations", (scope, schema, record) => {
    const parsed = schema.parse(record); const repository = new InMemoryIdempotencyRepository(); let calls = 0;
    expect(repository.execute(scope, parsed.idempotencyKey, JSON.stringify(parsed), () => ({ parsed, calls: ++calls }))).toEqual(repository.execute(scope, parsed.idempotencyKey, JSON.stringify(parsed), () => ({ parsed, calls: ++calls })));
    expect(calls).toBe(1);
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
  it("rejects live self-authored reputation after canonical EVM normalization", () => {
    expect(() => AgentReputationRefSchema.parse({ standard: "ERC-8004", network: "arc-testnet", chainId: "84532", registryAddress: "0xregistry", agentId: "agent-1", writerAddress: "0xAbCdEf0000000000000000000000000000001234", agentOwnerAddress: "0xaBcDeF0000000000000000000000000000001234", eventReference: "event-1", score: 1, tag: null, recordedAt: context.occurredAt, isMock: false })).toThrow();
  });
  it("accepts synthetic mock reputation identifiers without EVM-address validation", () => {
    expect(AgentReputationRefSchema.parse({ standard: "ERC-8004", network: "mock:network", chainId: "mock:chain", registryAddress: "mock:registry", agentId: "mock:agent", writerAddress: "mock:writer", agentOwnerAddress: "mock:owner", eventReference: "mock:event", score: 1, tag: null, recordedAt: null, isMock: true })).toMatchObject({ isMock: true, writerAddress: "mock:writer" });
  });
  it("requires truthful transaction lifecycle evidence for submitted, prepared, and confirmed states", () => {
    expect(() => ArcTransactionRefSchema.parse({ network: "ARC_TESTNET", chainId: "synthetic:chain", transactionHash: null, status: "SUBMITTED", blockNumber: null, blockHash: null, explorerUrl: null, operationType: "SETTLEMENT", isMock: true })).toThrow();
    expect(() => ArcTransactionRefSchema.parse({ network: "ARC_TESTNET", chainId: "synthetic:chain", transactionHash: null, status: "CONFIRMED", blockNumber: "1", blockHash: "synthetic:block", explorerUrl: null, operationType: "SETTLEMENT", isMock: true })).toThrow();
    expect(() => ArcTransactionRefSchema.parse({ network: "ARC_TESTNET", chainId: "synthetic:chain", transactionHash: null, status: "PREPARED", blockNumber: "1", blockHash: "synthetic:block", explorerUrl: null, operationType: "SETTLEMENT", isMock: true })).toThrow();
    expect(() => ArcTransactionRefSchema.parse({ network: "ARC_TESTNET", chainId: "synthetic:chain", transactionHash: "synthetic:tx", status: "FAILED", blockNumber: "1", blockHash: "synthetic:block", explorerUrl: null, operationType: "SETTLEMENT", isMock: true })).toThrow();
    expect(() => TransactionRecordSchema.parse({ id: "tx:1", intentId: "intent:1", idempotencyKey: "tx:key", amount: money("USDC", "1"), operationState: "CONFIRMED", arcTransaction: null, createdAt: context.occurredAt, updatedAt: context.occurredAt })).toThrow();
  });
  it("rejects registered identity without its registration reference", () => {
    const identity = new MockIdentityAdapter().getIdentity();
    expect(() => AgentIdentityRefSchema.parse({ ...identity, registrationStatus: "REGISTERED" })).toThrow();
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
    expect(new MockAgenticJobAdapter().transition(job, "FUNDED", context).job.status).toBe("FUNDED"); expect(job.status).toBe("OPEN");
  });
  it("requires every protocol-reference field", () => {
    const identity = new MockIdentityAdapter().getIdentity(); const { metadataVersion: _metadataVersion, ...missingIdentity } = identity;
    expect(() => AgentIdentityRefSchema.parse(missingIdentity)).toThrow();
    expect(() => AgentReputationRefSchema.parse({ standard: "ERC-8004", network: "mock:network", chainId: "mock:chain", registryAddress: "mock:registry", agentId: "mock:agent", writerAddress: "mock:writer", agentOwnerAddress: "mock:owner", eventReference: "mock:event", score: null, tag: null, recordedAt: null, isMock: true })).toThrow();
    expect(() => ArcTransactionRefSchema.parse({ network: "ARC_TESTNET", chainId: "synthetic:chain", transactionHash: null, status: "PREPARED", blockNumber: null, blockHash: null, explorerUrl: null, isMock: true })).toThrow();
    expect(() => AgenticJobRefSchema.parse({ standard: "ERC-8183", network: "mock:network", chainId: "mock:chain", contractAddress: "mock:contract", jobId: "mock:job", clientAddress: "mock:client", providerAddress: "mock:provider", evaluatorAddress: "mock:evaluator", status: "OPEN", transaction: null, isMock: true })).toThrow();
  });
});

describe("approval and vault invariants", () => {
  it("requires authorized human actors and decided timestamps for approved and rejected decisions", () => {
    const base = { id: "approval:1", actionType: "RELEASE", exactIntentHash: `sha256:${"a".repeat(64)}`, idempotencyKey: "approval:key", expiresAt: context.occurredAt };
    expect(ApprovalRecordSchema.parse({ ...base, decision: "APPROVED", approver: { actorId: "founder:1", actorType: "FOUNDER" }, decidedAt: context.occurredAt })).toMatchObject({ decision: "APPROVED" });
    expect(ApprovalRecordSchema.parse({ ...base, decision: "REJECTED", approver: { actorId: "evaluator:1", actorType: "EVALUATOR" }, decidedAt: context.occurredAt })).toMatchObject({ decision: "REJECTED" });
    expect(() => ApprovalRecordSchema.parse({ ...base, decision: "APPROVED", approver: { actorId: "ai:1", actorType: "AI" }, decidedAt: context.occurredAt })).toThrow();
    expect(() => ApprovalRecordSchema.parse({ ...base, decision: "REJECTED", approver: null, decidedAt: context.occurredAt })).toThrow();
    expect(() => ApprovalRecordSchema.parse({ ...base, decision: "APPROVED", approver: { actorId: "founder:1", actorType: "FOUNDER" }, decidedAt: null })).toThrow();
  });
  it("prevents pending approvals from masquerading as decided", () => {
    const base = { id: "approval:2", actionType: "RELEASE", exactIntentHash: `sha256:${"b".repeat(64)}`, idempotencyKey: "approval:key:2", expiresAt: context.occurredAt };
    expect(() => ApprovalRecordSchema.parse({ ...base, decision: "PENDING", approver: { actorId: "founder:1", actorType: "FOUNDER" }, decidedAt: null })).toThrow();
    expect(() => ApprovalRecordSchema.parse({ ...base, decision: "PENDING", approver: null, decidedAt: context.occurredAt })).toThrow();
  });
  it("requires vault and total-capital assets to match", () => {
    expect(() => LaunchVaultSchema.parse({ id: "vault:1", projectId: "project:1", asset: "USDC", totalCapital: money("EURC", "1"), mode: "MOCK", createdAt: context.occurredAt })).toThrow();
  });
});

describe("Backer-safe disclosure filtering", () => {
  it("allowlists approved disclosures and excludes every founder-private value", () => {
    const seed = createPawPovAiSeed(); const secret = "DO-NOT-DISCLOSE";
    const evidence = EvidenceItemSchema.parse({ id: "evidence:private", projectId: seed.project.id, kind: "RECEIPT", sourceHash: `sha256:${"b".repeat(64)}`, storageRef: `private://${secret}`, visibility: "FOUNDER_PRIVATE", submittedAt: context.occurredAt, rawContent: secret, privateNotes: secret });
    const proofs = [{ id: "proof:approved", milestoneId: seed.milestone.id, version: 1, approvedEvidenceHashes: [evidence.sourceHash], recordHash: `sha256:${"c".repeat(64)}`, visibility: "BACKER_SHARED" as const, createdAt: context.occurredAt }, { id: "proof:hidden", milestoneId: seed.milestone.id, version: 1, approvedEvidenceHashes: [], recordHash: `sha256:${"d".repeat(64)}`, visibility: "FOUNDER_PRIVATE" as const, createdAt: context.occurredAt }];
    const result = filterBackerDisclosure({ project: seed.project, evidence: [evidence], proofs, settlements: [{ id: "settlement:private", releaseRequestId: "release:1", idempotencyKey: "settlement:key", amount: money("USDC", "1"), state: "PENDING", job: null, transaction: null, updatedAt: context.occurredAt }], preferences: { ...seed.disclosurePreferences, discloseProofRecords: true, approvedProofIds: ["proof:approved"], discloseSettlementState: false } });
    expect(result.proofs.map((proof) => proof.id)).toEqual(["proof:approved"]); expect(result.settlements).toEqual([]); expect(result.evidence).toEqual([]);
    const serialized = JSON.stringify(result); expect(serialized).not.toContain(secret); expect(serialized).not.toContain("storageRef"); expect(serialized).not.toContain("privateNotes"); expect(serialized).not.toContain("proof:hidden"); expect(serialized).not.toContain("settlement:private");
  });
});

describe("PawPOVAI seed", () => {
  it("is reproducible and allocates exactly 1,000 test USDC", () => {
    const first = createPawPovAiSeed(); const second = createPawPovAiSeed(); expect(first).toEqual(second); expect(first).not.toBe(second);
    expect(first.reserves.reduce((total, reserve) => total + BigInt(reserve.allocated.atomicUnits), 0n).toString()).toBe("1000000000");
    expect(first.vault.totalCapital.atomicUnits).toBe("1000000000"); expect(first.milestone.proposedAmount.atomicUnits).toBe("250000000");
    expect(first.requirements).toHaveLength(6); expect(first.disclosurePreferences.discloseProofRecords).toBe(false);
  });
});
