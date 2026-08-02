import { describe, expect, it } from "vitest";
import {
  addMoney, AgenticJobStatusSchema, AgentReputationRefSchema, ArcTransactionRefSchema, compareMoney,
  createPawPovAiSeed, EvidenceItemSchema, IdempotencyConflictError, InMemoryAuditRepository,
  InMemoryIdempotencyRepository, InMemoryRepository, InvalidTransitionError, mapAgenticJobToApplication,
  MockAgenticJobAdapter, MockIdentityAdapter, MockWalletReferenceAdapter, money, MoneyAmountSchema, MoneyError,
  subtractMoney, transitionAgenticJob, transitionApplication,
} from "../src";

const context = { aggregateType: "milestone", aggregateId: "m1", eventId: "event:1", occurredAt: "2026-01-01T00:00:00.000Z", actor: { actorId: "system", actorType: "SYSTEM" as const } };

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
});

describe("protocol-safe mocks and privacy", () => {
  it("uses visibly synthetic wallet and unregistered identity references", () => {
    expect(new MockWalletReferenceAdapter().getReference()).toMatchObject({ mode: "MOCK", canSubmitTransactions: false, balanceAtomic: "1000000000" });
    expect(new MockIdentityAdapter().getIdentity()).toMatchObject({ isMock: true, registrationStatus: "UNREGISTERED", registrationTransactionHash: null });
  });
  it("does not permit owner-written reputation", () => {
    expect(() => AgentReputationRefSchema.parse({ standard: "ERC-8004", chainId: "mock", registryAddress: "mock", agentId: "mock", reputationId: "mock", writerAddress: "same", agentOwnerAddress: "same", value: "mock", transactionHash: null, recordedAt: null, isMock: true })).toThrow();
  });
  it("does not represent prepared activity as confirmed", () => {
    expect(() => ArcTransactionRefSchema.parse({ chain: "ARC_TESTNET", chainId: "synthetic", transactionHash: null, status: "SETTLED", blockNumber: null, explorerUrl: null, isMock: true })).toThrow();
  });
  it("keeps evidence private and excludes raw content and notes", () => {
    const evidence = EvidenceItemSchema.parse({ id: "e1", projectId: "p1", kind: "RECEIPT", sourceHash: `sha256:${"a".repeat(64)}`, storageRef: "private://e1", visibility: "FOUNDER_PRIVATE", submittedAt: "2026-01-01T00:00:00.000Z", rawContent: "secret", privateNotes: "secret" });
    expect(evidence).not.toHaveProperty("rawContent"); expect(evidence).not.toHaveProperty("privateNotes");
  });
  it("transitions only mock jobs without contract behavior", () => {
    const job = { standard: "ERC-8183" as const, chainId: "synthetic", contractAddress: "mock:not-a-contract", jobId: "mock:job", clientAddress: "mock:client", providerAddress: "mock:provider", evaluatorAddress: "mock:evaluator", status: "OPEN" as const, deliverableHash: null, transaction: null, isMock: true };
    expect(new MockAgenticJobAdapter().transition(job, "FUNDED", context).job.status).toBe("FUNDED"); expect(job.status).toBe("OPEN");
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
