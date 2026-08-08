import { describe, expect, it } from "vitest";
import {
  applyMissingReceiptRecovery,
  buildMilestoneEvaluationPacket,
  createPawPovAiEvidenceScenario,
  createStaticMockEvidenceExtractor,
  evaluateEvidenceEngine,
  type EvidenceEngineInput,
} from "../src/evidence-engine";
import { AuditEventSchema, EvidenceItemSchema, EvidenceMatchSchema } from "../src/models";

const resolvedAt = "2026-01-20T00:05:00.000Z";
const generatedAt = "2026-01-20T00:10:00.000Z";

function recoveredInput(): EvidenceEngineInput {
  const scenario = createPawPovAiEvidenceScenario();
  return {
    ...scenario.initialInput,
    evidenceItems: [...scenario.initialInput.evidenceItems, scenario.recoveryReceipt],
    evidenceMatches: [...scenario.initialInput.evidenceMatches, scenario.recoveryMatch],
  };
}

describe("bounded Evidence Engine", () => {
  it("exposes exactly one deterministic missing-receipt Proof Recovery gap", () => {
    const scenario = createPawPovAiEvidenceScenario();
    const first = evaluateEvidenceEngine(scenario.initialInput);
    const second = evaluateEvidenceEngine(scenario.initialInput);

    expect(first).toEqual(second);
    expect(first.proofGaps).toHaveLength(1);
    expect(first.proofGaps[0]).toMatchObject({
      id: "proof-gap:milestone:launch-ready:missing-receipt",
      requirementId: "requirement:expenses",
      reasonCode: "RECEIPT_EVIDENCE_MISSING",
      question: "Please add the missing receipt required for this milestone.",
      resolvedAt: null,
    });
    expect(first.evaluation.requirementEvaluations.find((item) => item.requirementId === "requirement:expenses")?.reasonCodes).toEqual(["RECEIPT_COUNT_SHORT"]);
    expect(first.evaluation.status).toBe("INCOMPLETE");
    expect(first.evaluation.erc8183ActionPermitted).toBe(false);
  });

  it("accepts one founder receipt correction, preserves append-only audit history, and becomes eligible for human approval", () => {
    const scenario = createPawPovAiEvidenceScenario();
    const first = evaluateEvidenceEngine(scenario.initialInput);
    const existingAudit = AuditEventSchema.parse({
      id: "audit:before-recovery",
      aggregateType: "MILESTONE",
      aggregateId: scenario.milestone.id,
      eventType: "EVIDENCE_REVIEW_STARTED",
      actor: { actorType: "SYSTEM", actorId: "system:proofspend" },
      idempotencyKey: null,
      occurredAt: scenario.initialInput.evaluatedAt,
      details: { policyVersion: scenario.initialInput.policyVersion },
    });

    const recovered = applyMissingReceiptRecovery({
      input: scenario.initialInput,
      gap: first.proofGaps[0],
      receipt: scenario.recoveryReceipt,
      acceptedMatch: scenario.recoveryMatch,
      actor: scenario.authorizedFounder,
      resolvedAt,
      existingAuditEvents: [existingAudit],
    });

    expect(recovered.originalGap.resolvedAt).toBeNull();
    expect(recovered.resolvedGap.resolvedAt).toBe(resolvedAt);
    expect(recovered.auditEvents).toHaveLength(2);
    expect(recovered.auditEvents[0]).toEqual(existingAudit);
    expect(recovered.auditEvents[1]).toMatchObject({
      eventType: "PROOF_RECOVERY_ACCEPTED",
      aggregateId: first.proofGaps[0].id,
      actor: scenario.authorizedFounder,
      details: {
        evidenceId: scenario.recoveryReceipt.id,
        evidenceHash: scenario.recoveryReceipt.sourceHash,
        resolution: "ADDITIONAL_RECEIPT_ACCEPTED",
      },
    });
    expect(recovered.evaluation.status).toBe("ELIGIBLE");
    expect(recovered.evaluation.humanApprovalRequired).toBe(true);
    expect(recovered.evaluation.recommendedNextAction).toBe("REQUEST_HUMAN_APPROVAL");
    expect(recovered.evaluation.erc8183ActionPermitted).toBe(false);
  });

  it("keeps AI suggestions separate from accepted HUMAN_DECISION provenance", () => {
    const input = recoveredInput();
    const txHuman = input.evidenceMatches.find((match) => match.requirementId === "requirement:transaction-match" && match.source === "HUMAN_DECISION");
    expect(txHuman).toBeDefined();
    const aiSuggestion = EvidenceMatchSchema.parse({
      ...txHuman,
      id: "match:pawpovai:transaction-context:ai",
      source: "AI_SUGGESTION",
      confidenceBasisPoints: 9700,
      explanation: "AI suggests a transaction match.",
      acceptedBy: null,
    });
    const aiOnlyInput: EvidenceEngineInput = {
      ...input,
      evidenceMatches: [...input.evidenceMatches.filter((match) => match.id !== txHuman?.id), aiSuggestion],
    };
    const result = evaluateEvidenceEngine(aiOnlyInput);
    const txResult = result.evaluation.requirementEvaluations.find((item) => item.requirementId === "requirement:transaction-match");

    expect(txResult?.outcome).toBe("REVIEW");
    expect(txResult?.reasonCodes).toEqual(["EVIDENCE_MISSING"]);
    expect(result.evaluation.status).toBe("NEEDS_REVIEW");
    expect(result.evaluation.erc8183ActionPermitted).toBe(false);
  });

  it("fails closed on duplicate evidence IDs and duplicate canonical hashes", () => {
    const scenario = createPawPovAiEvidenceScenario();
    const duplicateId = EvidenceItemSchema.parse({
      ...scenario.initialInput.evidenceItems[0],
      sourceHash: `sha256:${"a".repeat(64)}`,
    });
    expect(() => evaluateEvidenceEngine({
      ...scenario.initialInput,
      evidenceItems: [...scenario.initialInput.evidenceItems, duplicateId],
    })).toThrow(/Evidence IDs must be unique/i);

    const duplicateHash = EvidenceItemSchema.parse({
      ...scenario.initialInput.evidenceItems[0],
      id: "evidence:pawpovai:duplicate-hash",
    });
    expect(() => evaluateEvidenceEngine({
      ...scenario.initialInput,
      evidenceItems: [...scenario.initialInput.evidenceItems, duplicateHash],
    })).toThrow(/evidence hashes must be unique/i);
  });

  it("rejects foreign-project evidence and does not let a wrong-requirement match clear the receipt gap", () => {
    const scenario = createPawPovAiEvidenceScenario();
    const foreign = EvidenceItemSchema.parse({
      ...scenario.recoveryReceipt,
      id: "evidence:foreign:receipt",
      projectId: "project:other",
      sourceHash: `sha256:${"b".repeat(64)}`,
    });
    expect(() => evaluateEvidenceEngine({
      ...scenario.initialInput,
      evidenceItems: [...scenario.initialInput.evidenceItems, foreign],
    })).toThrow(/foreign-project evidence/i);

    const wrongRequirementMatch = EvidenceMatchSchema.parse({
      ...scenario.recoveryMatch,
      id: "match:pawpovai:receipt:2:wrong-requirement",
      requirementId: "requirement:transaction-match",
    });
    const wrongRequirement = evaluateEvidenceEngine({
      ...scenario.initialInput,
      evidenceItems: [...scenario.initialInput.evidenceItems, scenario.recoveryReceipt],
      evidenceMatches: [...scenario.initialInput.evidenceMatches, wrongRequirementMatch],
    });
    expect(wrongRequirement.proofGaps).toHaveLength(1);
    expect(wrongRequirement.evaluation.status).not.toBe("ELIGIBLE");
  });

  it("keeps raw founder-private content out of evaluation, audit details, and evaluator packet", async () => {
    const scenario = createPawPovAiEvidenceScenario();
    const first = evaluateEvidenceEngine(scenario.initialInput);
    const secretMarker = "RAW_PRIVATE_RECEIPT_DO_NOT_DISCLOSE";
    const privateReceipt = EvidenceItemSchema.parse({
      ...scenario.recoveryReceipt,
      storageRef: `private://${secretMarker}`,
    });
    const recovered = applyMissingReceiptRecovery({
      input: scenario.initialInput,
      gap: first.proofGaps[0],
      receipt: privateReceipt,
      acceptedMatch: scenario.recoveryMatch,
      actor: scenario.authorizedFounder,
      resolvedAt,
    });
    const packet = await buildMilestoneEvaluationPacket({
      milestoneId: scenario.milestone.id,
      evaluation: recovered.evaluation,
      evidenceItems: recovered.input.evidenceItems,
      verifiedSpend: recovered.input.verifiedSpend,
      proofGaps: [recovered.resolvedGap],
      generatedAt,
    });

    expect(JSON.stringify(recovered.evaluation)).not.toContain(secretMarker);
    expect(JSON.stringify(recovered.auditEvents)).not.toContain(secretMarker);
    expect(JSON.stringify(packet)).not.toContain(secretMarker);
  });

  it("builds byte-for-byte deterministic evaluator packets with stable sorted inputs", async () => {
    const scenario = createPawPovAiEvidenceScenario();
    const first = evaluateEvidenceEngine(scenario.initialInput);
    const recovered = applyMissingReceiptRecovery({
      input: scenario.initialInput,
      gap: first.proofGaps[0],
      receipt: scenario.recoveryReceipt,
      acceptedMatch: scenario.recoveryMatch,
      actor: scenario.authorizedFounder,
      resolvedAt,
    });

    const packetA = await buildMilestoneEvaluationPacket({
      milestoneId: scenario.milestone.id,
      evaluation: recovered.evaluation,
      evidenceItems: [...recovered.input.evidenceItems].reverse(),
      verifiedSpend: recovered.input.verifiedSpend,
      proofGaps: [recovered.resolvedGap],
      generatedAt,
    });
    const packetB = await buildMilestoneEvaluationPacket({
      milestoneId: scenario.milestone.id,
      evaluation: recovered.evaluation,
      evidenceItems: recovered.input.evidenceItems,
      verifiedSpend: recovered.input.verifiedSpend,
      proofGaps: [recovered.resolvedGap],
      generatedAt,
    });

    expect(JSON.stringify(packetA)).toBe(JSON.stringify(packetB));
    expect(packetA.milestoneId).toBe(scenario.milestone.id);
    expect(packetA.evidenceIds).toEqual([...packetA.evidenceIds].sort());
    expect(packetA.evidenceHashes).toEqual([...packetA.evidenceHashes].sort());
    expect(packetA.unresolvedProofGapIds).toEqual([]);
    expect(packetA.recommendedNextAction).toBe("REQUEST_HUMAN_APPROVAL");
  });

  it("changes packet hash candidates when canonical evidence, milestone, or proof-gap inputs change", async () => {
    const scenario = createPawPovAiEvidenceScenario();
    const first = evaluateEvidenceEngine(scenario.initialInput);
    const initialPacket = await buildMilestoneEvaluationPacket({
      milestoneId: scenario.milestone.id,
      evaluation: first.evaluation,
      evidenceItems: scenario.initialInput.evidenceItems,
      verifiedSpend: scenario.initialInput.verifiedSpend,
      proofGaps: first.proofGaps,
      generatedAt,
    });
    const changedEvidence = scenario.initialInput.evidenceItems.map((item, index) => index === 0
      ? EvidenceItemSchema.parse({ ...item, sourceHash: `sha256:${"c".repeat(64)}` })
      : item);
    const changedEvidencePacket = await buildMilestoneEvaluationPacket({
      milestoneId: scenario.milestone.id,
      evaluation: first.evaluation,
      evidenceItems: changedEvidence,
      verifiedSpend: scenario.initialInput.verifiedSpend,
      proofGaps: first.proofGaps,
      generatedAt,
    });
    expect(changedEvidencePacket.deliverableHashCandidate).not.toBe(initialPacket.deliverableHashCandidate);

    const otherMilestonePacket = await buildMilestoneEvaluationPacket({
      milestoneId: "milestone:other",
      evaluation: first.evaluation,
      evidenceItems: scenario.initialInput.evidenceItems,
      verifiedSpend: scenario.initialInput.verifiedSpend,
      proofGaps: [],
      generatedAt,
    });
    expect(otherMilestonePacket.deliverableHashCandidate).not.toBe(initialPacket.deliverableHashCandidate);
    expect(otherMilestonePacket.reasonHashCandidate).not.toBe(initialPacket.reasonHashCandidate);

    const recovered = applyMissingReceiptRecovery({
      input: scenario.initialInput,
      gap: first.proofGaps[0],
      receipt: scenario.recoveryReceipt,
      acceptedMatch: scenario.recoveryMatch,
      actor: scenario.authorizedFounder,
      resolvedAt,
    });
    const recoveredPacket = await buildMilestoneEvaluationPacket({
      milestoneId: scenario.milestone.id,
      evaluation: recovered.evaluation,
      evidenceItems: recovered.input.evidenceItems,
      verifiedSpend: recovered.input.verifiedSpend,
      proofGaps: [recovered.resolvedGap],
      generatedAt,
    });
    expect(recoveredPacket.reasonHashCandidate).not.toBe(initialPacket.reasonHashCandidate);
  });

  it("rejects proof gaps that do not belong to the packet milestone", async () => {
    const scenario = createPawPovAiEvidenceScenario();
    const first = evaluateEvidenceEngine(scenario.initialInput);
    await expect(buildMilestoneEvaluationPacket({
      milestoneId: "milestone:other",
      evaluation: first.evaluation,
      evidenceItems: scenario.initialInput.evidenceItems,
      verifiedSpend: scenario.initialInput.verifiedSpend,
      proofGaps: first.proofGaps,
      generatedAt,
    })).rejects.toThrow(/proof gaps must belong to the exact milestone/i);
  });

  it("treats verified spend as an upstream atomic-USDC fact that mock extraction cannot override", () => {
    const scenario = createPawPovAiEvidenceScenario();
    const deliverable = scenario.initialInput.evidenceItems.find((item) => item.kind === "DELIVERABLE");
    expect(deliverable).toBeDefined();
    const extractor = createStaticMockEvidenceExtractor([{
      evidenceId: deliverable!.id,
      observedFactCodes: ["MOCK_SPEND_CANDIDATE"],
      normalizedValues: { suggestedAtomicUnits: "999999999999" },
      suggestedRequirementIds: ["requirement:spend"],
      confidenceBasisPoints: 9999,
      unresolvedAmbiguityReasonCode: null,
    }]);
    expect(extractor.extract(deliverable!).normalizedValues.suggestedAtomicUnits).toBe("999999999999");

    const result = evaluateEvidenceEngine(scenario.initialInput);
    expect(scenario.initialInput.verifiedSpend.atomicUnits).toBe("125000000");
    expect(result.evaluation.requirementEvaluations.find((item) => item.requirementId === "requirement:spend")?.reasonCodes).toEqual(["SPEND_WITHIN_LIMIT"]);
  });

  it("requires recovery to be accepted by the exact audit actor and exact receipt requirement", () => {
    const scenario = createPawPovAiEvidenceScenario();
    const first = evaluateEvidenceEngine(scenario.initialInput);
    expect(() => applyMissingReceiptRecovery({
      input: scenario.initialInput,
      gap: first.proofGaps[0],
      receipt: scenario.recoveryReceipt,
      acceptedMatch: scenario.recoveryMatch,
      actor: scenario.authorizedEvaluator,
      resolvedAt,
    })).toThrow(/audit actor/i);
  });
});
