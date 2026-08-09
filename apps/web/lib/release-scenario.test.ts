import { describe, expect, it } from "vitest";
import {
  ApprovalRecordSchema,
  EvidenceItemSchema,
  MilestoneSchema,
  ProofOfProgressSchema,
  ReconciliationRecordSchema,
  ReleaseRequestSchema,
  SettlementRecordSchema,
  TransactionRecordSchema,
} from "@proofspend/domain";

import { buildBackerDisclosure, buildReleaseScenario } from "./release-scenario";

describe("release lifecycle mock scenario", () => {
  const scenario = buildReleaseScenario();

  it("produces a milestone and evidence set that satisfy the real domain schemas", () => {
    expect(() => MilestoneSchema.parse(scenario.milestone)).not.toThrow();
    expect(() => ProofOfProgressSchema.parse(scenario.proof)).not.toThrow();
    for (const entry of scenario.evidence) {
      expect(() => EvidenceItemSchema.parse(entry.item)).not.toThrow();
    }
  });

  it("produces every release-lifecycle snapshot as schema-valid domain records", () => {
    for (const snapshot of Object.values(scenario.snapshots)) {
      expect(() => ReleaseRequestSchema.parse(snapshot.release)).not.toThrow();
      if (snapshot.approval) expect(() => ApprovalRecordSchema.parse(snapshot.approval)).not.toThrow();
      if (snapshot.transaction) expect(() => TransactionRecordSchema.parse(snapshot.transaction)).not.toThrow();
      if (snapshot.settlement) expect(() => SettlementRecordSchema.parse(snapshot.settlement)).not.toThrow();
      if (snapshot.reconciliation) expect(() => ReconciliationRecordSchema.parse(snapshot.reconciliation)).not.toThrow();
    }
  });

  it("marks every synthetic reference as mock so it can never render as live", () => {
    for (const snapshot of Object.values(scenario.snapshots)) {
      if (snapshot.transaction?.arcTransaction) expect(snapshot.transaction.arcTransaction.isMock).toBe(true);
    }
  });

  it("keeps the Backer View disclosure free of founder-private evidence", () => {
    const disclosure = buildBackerDisclosure(scenario);
    expect(disclosure.evidence).toEqual([]);
    expect(disclosure.settlements.length).toBeGreaterThan(0);
    expect(disclosure.proofs.length).toBeGreaterThan(0);
    for (const settlement of disclosure.settlements) {
      expect(settlement).not.toHaveProperty("job");
      expect(settlement).not.toHaveProperty("transaction");
    }
  });

  it("proposes a 1 test USDC release, distinct from the 150 test USDC spend-limit requirement", () => {
    expect(scenario.milestone.proposedAmount).toEqual({ asset: "USDC", atomicUnits: "1000000" });

    const spendRequirement = scenario.requirements.find((requirement) => requirement.kind === "SPEND_LIMIT");
    expect(spendRequirement?.spendLimit).toEqual({ asset: "USDC", atomicUnits: "150000000" });
  });

  it("propagates the 1 test USDC release amount consistently across every lifecycle record", () => {
    const expectedAmount = { asset: "USDC", atomicUnits: "1000000" };
    for (const snapshot of Object.values(scenario.snapshots)) {
      expect(snapshot.release.amount).toEqual(expectedAmount);
      if (snapshot.transaction) expect(snapshot.transaction.amount).toEqual(expectedAmount);
      if (snapshot.settlement) expect(snapshot.settlement.amount).toEqual(expectedAmount);
    }
  });

  it("never hardcodes 150000000 as a release, transaction, or settlement amount", () => {
    for (const snapshot of Object.values(scenario.snapshots)) {
      expect(snapshot.release.amount.atomicUnits).not.toBe("150000000");
      if (snapshot.transaction) expect(snapshot.transaction.amount.atomicUnits).not.toBe("150000000");
      if (snapshot.settlement) expect(snapshot.settlement.amount.atomicUnits).not.toBe("150000000");
    }
  });

  it("uses the same 1 test USDC release amount for the Backer View settlement disclosure", () => {
    const disclosure = buildBackerDisclosure(scenario);
    for (const settlement of disclosure.settlements) {
      expect(settlement.amount).toEqual({ asset: "USDC", atomicUnits: "1000000" });
    }
  });

  it("keeps unevaluated evidence descriptions free of outcome language", () => {
    const outcomeWords = /\b(confirmed|reconciled|satisfied|passed|approved)\b/i;
    for (const entry of scenario.evidence) {
      expect(entry.matchExplanation).not.toMatch(outcomeWords);
    }
  });
});
