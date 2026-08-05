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
});
