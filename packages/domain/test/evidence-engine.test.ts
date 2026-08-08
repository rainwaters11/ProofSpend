import { describe, expect, it } from "vitest";
import {
  applyMissingReceiptRecovery,
  buildMilestoneEvaluationPacket,
  createPawPovAiEvidenceScenario,
  createStaticMockEvidenceExtractor,
  evaluateEvidenceEngine,
  type EvidenceEngineInput,
} from "../src/evidence-engine";
import { AuditEventSchema, EvidenceItemSchema, EvidenceMatchSchema, MilestoneRequirementSchema } from "../src/models";

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

  it("routes an uploaded AI-suggested receipt to human review instead of duplicate Proof Recovery", () => {
    const scenario = createPawPovAiEvidenceScenario();
    const aiSuggestedReceipt = EvidenceMatchSchema.parse({
      id: "match:pawpovai:receipt:2:ai",
      evidenceId: scenario.recoveryReceipt.id,
      requirementId: "requirement:expenses",
      source: "AI_SUGGESTION",
      confidenceBasisPoints: 9200,
      explanation: "AI suggested the uploaded receipt for evaluator review.",
      acceptedBy: null,
    });
    const result = evaluateEvidenceEngine({
      ...scenario.initialInput,
      evidenceItems: [...scenario.initialInput.evidenceItems, scenario.recoveryReceipt],
      evidenceMatches: [...scenario.initialInput.evidenceMatches, aiSuggestedReceipt],
    });

    expect(result.proofGaps).toEqual([]);
    expect(result.evaluation.status).toBe("NEEDS_REVIEW");
    expect(result.evaluation.recommendedNextAction).toBe("REQUEST_HUMAN_REVIEW");
    expect(result.evaluation.requirementEvaluations.find((item) => item.requirementId === "requirement:expenses")).toMatchObject({
      outcome: "REVIEW",
      reasonCodes: ["EVIDENCE_MISSING"],
    });
    expect(result.evaluation.erc8183ActionPermitted).toBe(false);
  });

  it("keeps the canonical landing and flyer deliverables in evaluation and packet commitments", async () => {
    const input = recoveredInput();
    const result = evaluateEvidenceEngine(input);
    const canonicalDeliverables = ["requirement:landing", "requirement:flyer"];

    expect(input.milestone.requirementIds).toEqual(expect.arrayContaining(canonicalDeliverables));
    for (const requirementId of canonicalDeliverables) {
      expect(result.evaluation.requirementEvaluations.find((item) => item.requirementId === requirementId)).toMatchObject({
        outcome: "PASS",
        reasonCodes: ["DELIVERABLE_COUNT_MET"],
      });
    }

    const packet = await buildMilestoneEvaluationPacket({
      input,
      evaluation: result.evaluation,
      proofGaps: result.proofGaps,
      generatedAt,
    });
    expect(packet.evidenceBindings).toEqual(expect.arrayContaining([
      {
        evidenceId: "evidence:pawpovai:landing",
        evidenceHash: `sha256:${"8".repeat(64)}`,
        requirementId: "requirement:landing",
      },
      {
        evidenceId: "evidence:pawpovai:flyer",
        evidenceHash: `sha256:${"9".repeat(64)}`,
        requirementId: "requirement:flyer",
      },
    ]));
  });

  it("blocks eligibility when either canonical deliverable is absent", () => {
    for (const [requirementId, evidenceId] of [
      ["requirement:landing", "evidence:pawpovai:landing"],
      ["requirement:flyer", "evidence:pawpovai:flyer"],
    ] as const) {
      const input = recoveredInput();
      const result = evaluateEvidenceEngine({
        ...input,
        evidenceItems: input.evidenceItems.filter((item) => item.id !== evidenceId),
        evidenceMatches: input.evidenceMatches.filter((match) => match.evidenceId !== evidenceId),
      });

      expect(result.evaluation.status).toBe("INCOMPLETE");
      expect(result.evaluation.requirementEvaluations.find((item) => item.requirementId === requirementId)).toMatchObject({
        outcome: "FAIL",
        reasonCodes: ["DELIVERABLE_COUNT_SHORT"],
      });
    }
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
    expect(recovered.input.evaluatedAt).toBe(resolvedAt);
    expect(recovered.evaluation.evaluationTimestamp).toBe(resolvedAt);
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

  it("deduplicates exact recovery retries and rejects conflicting idempotency reuse", () => {
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
    const retried = applyMissingReceiptRecovery({
      input: scenario.initialInput,
      gap: first.proofGaps[0],
      receipt: scenario.recoveryReceipt,
      acceptedMatch: scenario.recoveryMatch,
      actor: scenario.authorizedFounder,
      resolvedAt,
      existingAuditEvents: recovered.auditEvents,
    });

    expect(retried.auditEvents).toEqual(recovered.auditEvents);
    expect(retried.auditEvents).toHaveLength(1);

    const conflicting = AuditEventSchema.parse({
      ...recovered.auditEvents[0],
      details: { ...recovered.auditEvents[0].details, resolution: "CONFLICTING_RECOVERY" },
    });
    expect(() => applyMissingReceiptRecovery({
      input: scenario.initialInput,
      gap: first.proofGaps[0],
      receipt: scenario.recoveryReceipt,
      acceptedMatch: scenario.recoveryMatch,
      actor: scenario.authorizedFounder,
      resolvedAt,
      existingAuditEvents: [conflicting],
    })).toThrow(/idempotency key|audit event ID/i);
  });

  it("allows an exact recovery retry after later unrelated append-only audit history", () => {
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
    const laterAudit = AuditEventSchema.parse({
      id: "audit:later-unrelated",
      aggregateType: "MILESTONE",
      aggregateId: scenario.milestone.id,
      eventType: "LATER_UNRELATED_EVENT",
      actor: scenario.authorizedFounder,
      idempotencyKey: null,
      occurredAt: "2026-01-20T00:06:00.000Z",
      details: { scope: "UNRELATED" },
    });
    const retried = applyMissingReceiptRecovery({
      input: scenario.initialInput,
      gap: first.proofGaps[0],
      receipt: scenario.recoveryReceipt,
      acceptedMatch: scenario.recoveryMatch,
      actor: scenario.authorizedFounder,
      resolvedAt,
      existingAuditEvents: [...recovered.auditEvents, laterAudit],
    });

    expect(retried.auditEvents).toEqual([...recovered.auditEvents, laterAudit]);
  });

  it("rejects any conflicting recovery collision even after an exact retry event", () => {
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
    const conflicting = AuditEventSchema.parse({
      ...recovered.auditEvents[0],
      details: { ...recovered.auditEvents[0].details, resolution: "CONFLICTING_RECOVERY" },
    });

    expect(() => applyMissingReceiptRecovery({
      input: scenario.initialInput,
      gap: first.proofGaps[0],
      receipt: scenario.recoveryReceipt,
      acceptedMatch: scenario.recoveryMatch,
      actor: scenario.authorizedFounder,
      resolvedAt,
      existingAuditEvents: [recovered.auditEvents[0], conflicting],
    })).toThrow(/idempotency key|audit event ID/i);
  });

  it("rejects recovery timestamps that predate the evaluated evidence state", () => {
    const scenario = createPawPovAiEvidenceScenario();
    const first = evaluateEvidenceEngine(scenario.initialInput);

    expect(() => applyMissingReceiptRecovery({
      input: scenario.initialInput,
      gap: first.proofGaps[0],
      receipt: scenario.recoveryReceipt,
      acceptedMatch: scenario.recoveryMatch,
      actor: scenario.authorizedFounder,
      resolvedAt: "2026-01-19T23:59:59.000Z",
    })).toThrow(/time must not precede/i);
  });

  it("deduplicates repeated accepted evidence references under distinct match IDs", () => {
    const scenario = createPawPovAiEvidenceScenario();
    const baseline = evaluateEvidenceEngine(scenario.initialInput);
    const originalMatch = scenario.initialInput.evidenceMatches.find((match) => match.id === "match:pawpovai:receipt:1");
    expect(originalMatch).toBeDefined();
    const retriedMatch = EvidenceMatchSchema.parse({
      ...originalMatch!,
      id: "match:pawpovai:receipt:1:retry",
    });
    const retried = evaluateEvidenceEngine({
      ...scenario.initialInput,
      evidenceMatches: [...scenario.initialInput.evidenceMatches, retriedMatch],
    });

    expect(retried).toEqual(baseline);
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

  it("requires the exact configured founder for founder confirmation", () => {
    const scenario = createPawPovAiEvidenceScenario();
    const input = recoveredInput();
    const confirmationMatch = input.evidenceMatches.find((match) => match.requirementId === "requirement:confirmation" && match.source === "HUMAN_DECISION");
    expect(confirmationMatch).toBeDefined();
    const evaluatorConfirmation = EvidenceMatchSchema.parse({
      ...confirmationMatch!,
      id: "match:pawpovai:confirmation:evaluator",
      acceptedBy: scenario.authorizedEvaluator,
    });
    const result = evaluateEvidenceEngine({
      ...input,
      evidenceMatches: [...input.evidenceMatches.filter((match) => match.id !== confirmationMatch?.id), evaluatorConfirmation],
    });
    const confirmation = result.evaluation.requirementEvaluations.find((item) => item.requirementId === "requirement:confirmation");

    expect(confirmation?.outcome).not.toBe("PASS");
    expect(result.evaluation.status).not.toBe("ELIGIBLE");
  });

  it("rejects evidence submitted after the evaluation timestamp", () => {
    const scenario = createPawPovAiEvidenceScenario();
    const futureEvidence = EvidenceItemSchema.parse({
      ...scenario.initialInput.evidenceItems[0],
      submittedAt: "2026-01-20T00:00:01.000Z",
    });

    expect(() => evaluateEvidenceEngine({
      ...scenario.initialInput,
      evidenceItems: [futureEvidence, ...scenario.initialInput.evidenceItems.slice(1)],
    })).toThrow(/submitted after the evaluation timestamp/i);
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
      input: recovered.input,
      evaluation: recovered.evaluation,
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
    const reorderedInput: EvidenceEngineInput = {
      ...recovered.input,
      evidenceItems: [...recovered.input.evidenceItems].reverse(),
      evidenceMatches: [...recovered.input.evidenceMatches].reverse(),
      requirements: [...recovered.input.requirements].reverse(),
      milestone: { ...recovered.input.milestone, requirementIds: [...recovered.input.milestone.requirementIds].reverse() },
    };
    const reorderedEvaluation = evaluateEvidenceEngine(reorderedInput).evaluation;

    const packetA = await buildMilestoneEvaluationPacket({
      input: reorderedInput,
      evaluation: reorderedEvaluation,
      proofGaps: [recovered.resolvedGap],
      generatedAt,
    });
    const packetB = await buildMilestoneEvaluationPacket({
      input: recovered.input,
      evaluation: recovered.evaluation,
      proofGaps: [recovered.resolvedGap],
      generatedAt,
    });

    expect(JSON.stringify(packetA)).toBe(JSON.stringify(packetB));
    expect(packetA.milestoneId).toBe(scenario.milestone.id);
    expect(packetA.evidenceIds).toEqual([...packetA.evidenceIds].sort());
    expect(packetA.evidenceHashes).toEqual([...packetA.evidenceHashes].sort());
    expect(packetA.evidenceBindings).toEqual([...packetA.evidenceBindings].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)));
    expect(packetA.unresolvedProofGapIds).toEqual([]);
    expect(packetA.recommendedNextAction).toBe("REQUEST_HUMAN_APPROVAL");
  });

  it("excludes unmatched and AI-only evidence from evaluator packet commitments", async () => {
    const scenario = createPawPovAiEvidenceScenario();
    const first = evaluateEvidenceEngine(scenario.initialInput);
    const baseline = await buildMilestoneEvaluationPacket({
      input: scenario.initialInput,
      evaluation: first.evaluation,
      proofGaps: first.proofGaps,
      generatedAt,
    });
    const unapproved = EvidenceItemSchema.parse({
      id: "evidence:pawpovai:unapproved",
      projectId: scenario.milestone.projectId,
      kind: "STATEMENT",
      sourceHash: `sha256:${"7".repeat(64)}`,
      storageRef: "private://pawpovai/unapproved",
      visibility: "FOUNDER_PRIVATE",
      submittedAt: scenario.initialInput.evaluatedAt,
    });
    const aiOnly = EvidenceMatchSchema.parse({
      id: "match:pawpovai:unapproved:ai",
      evidenceId: unapproved.id,
      requirementId: "requirement:business-purpose",
      source: "AI_SUGGESTION",
      confidenceBasisPoints: 9000,
      explanation: "AI-only extra evidence suggestion.",
      acceptedBy: null,
    });
    const augmentedInput: EvidenceEngineInput = {
      ...scenario.initialInput,
      evidenceItems: [...scenario.initialInput.evidenceItems, unapproved],
      evidenceMatches: [...scenario.initialInput.evidenceMatches, aiOnly],
    };
    const augmentedEvaluation = evaluateEvidenceEngine(augmentedInput).evaluation;
    const packet = await buildMilestoneEvaluationPacket({
      input: augmentedInput,
      evaluation: augmentedEvaluation,
      proofGaps: first.proofGaps,
      generatedAt,
    });

    expect(packet.evidenceIds).not.toContain(unapproved.id);
    expect(packet.evidenceHashes).not.toContain(unapproved.sourceHash);
    expect(packet.evidenceBindings.some((binding) => binding.evidenceId === unapproved.id)).toBe(false);
    expect(packet.deliverableHashCandidate).toBe(baseline.deliverableHashCandidate);
  });

  it("binds evidence ID, hash, and requirement mappings into the deliverable commitment", async () => {
    const scenario = createPawPovAiEvidenceScenario();
    const baselineResult = evaluateEvidenceEngine(scenario.initialInput);
    const baseline = await buildMilestoneEvaluationPacket({
      input: scenario.initialInput,
      evaluation: baselineResult.evaluation,
      proofGaps: baselineResult.proofGaps,
      generatedAt,
    });

    const deliverable = scenario.initialInput.evidenceItems.find((item) => item.id === "evidence:pawpovai:deliverable")!;
    const transaction = scenario.initialInput.evidenceItems.find((item) => item.id === "evidence:pawpovai:transaction-context")!;
    const swappedHashesInput: EvidenceEngineInput = {
      ...scenario.initialInput,
      evidenceItems: scenario.initialInput.evidenceItems.map((item) => {
        if (item.id === deliverable.id) return EvidenceItemSchema.parse({ ...item, sourceHash: transaction.sourceHash });
        if (item.id === transaction.id) return EvidenceItemSchema.parse({ ...item, sourceHash: deliverable.sourceHash });
        return item;
      }),
    };
    const swappedHashesResult = evaluateEvidenceEngine(swappedHashesInput);
    expect(swappedHashesResult.evaluation).toEqual(baselineResult.evaluation);
    const swappedHashesPacket = await buildMilestoneEvaluationPacket({
      input: swappedHashesInput,
      evaluation: swappedHashesResult.evaluation,
      proofGaps: swappedHashesResult.proofGaps,
      generatedAt,
    });
    expect(swappedHashesPacket.deliverableHashCandidate).not.toBe(baseline.deliverableHashCandidate);

    const transactionMatch = scenario.initialInput.evidenceMatches.find((match) => match.id === "match:pawpovai:transaction-context")!;
    const purposeMatch = scenario.initialInput.evidenceMatches.find((match) => match.id === "match:pawpovai:business-purpose")!;
    const swappedRequirementsInput: EvidenceEngineInput = {
      ...scenario.initialInput,
      evidenceMatches: scenario.initialInput.evidenceMatches.map((match) => {
        if (match.id === transactionMatch.id) return EvidenceMatchSchema.parse({ ...match, requirementId: purposeMatch.requirementId });
        if (match.id === purposeMatch.id) return EvidenceMatchSchema.parse({ ...match, requirementId: transactionMatch.requirementId });
        return match;
      }),
    };
    const swappedRequirementsResult = evaluateEvidenceEngine(swappedRequirementsInput);
    expect(swappedRequirementsResult.evaluation.status).toBe(baselineResult.evaluation.status);
    const swappedRequirementsPacket = await buildMilestoneEvaluationPacket({
      input: swappedRequirementsInput,
      evaluation: swappedRequirementsResult.evaluation,
      proofGaps: swappedRequirementsResult.proofGaps,
      generatedAt,
    });
    expect(swappedRequirementsPacket.deliverableHashCandidate).not.toBe(baseline.deliverableHashCandidate);
  });

  it("binds canonical requirement definitions into both packet commitments", async () => {
    const input = recoveredInput();
    const baselineResult = evaluateEvidenceEngine(input);
    const baselinePacket = await buildMilestoneEvaluationPacket({
      input,
      evaluation: baselineResult.evaluation,
      proofGaps: baselineResult.proofGaps,
      generatedAt,
    });
    const changedInput: EvidenceEngineInput = {
      ...input,
      requirements: input.requirements.map((requirement) =>
        requirement.kind === "EXPENSE_RECORDS"
          ? { ...requirement, requiredCount: 1 }
          : requirement
      ),
    };
    const changedResult = evaluateEvidenceEngine(changedInput);
    expect(changedResult.evaluation).toEqual(baselineResult.evaluation);
    const changedPacket = await buildMilestoneEvaluationPacket({
      input: changedInput,
      evaluation: changedResult.evaluation,
      proofGaps: changedResult.proofGaps,
      generatedAt,
    });

    expect(changedPacket.requirementDefinitions).not.toEqual(baselinePacket.requirementDefinitions);
    expect(changedPacket.deliverableHashCandidate).not.toBe(baselinePacket.deliverableHashCandidate);
    expect(changedPacket.reasonHashCandidate).not.toBe(baselinePacket.reasonHashCandidate);
  });

  it("binds canonical milestone fields including dueAt into both packet commitments", async () => {
    const input = recoveredInput();
    const dueDateRequirement = MilestoneRequirementSchema.parse({
      id: "requirement:due-date",
      milestoneId: input.milestone.id,
      kind: "DUE_DATE",
      description: "Launch evidence must be evaluated before the deadline.",
    });
    const withDueAt = (dueAt: string): EvidenceEngineInput => ({
      ...input,
      milestone: {
        ...input.milestone,
        dueAt,
        requirementIds: [...input.milestone.requirementIds, dueDateRequirement.id],
      },
      requirements: [...input.requirements, dueDateRequirement],
    });
    const earlierDeadlineInput = withDueAt("2026-02-01T00:00:00.000Z");
    const laterDeadlineInput = withDueAt("2026-02-15T00:00:00.000Z");
    const earlierResult = evaluateEvidenceEngine(earlierDeadlineInput);
    const laterResult = evaluateEvidenceEngine(laterDeadlineInput);

    expect(laterResult.evaluation).toEqual(earlierResult.evaluation);
    const earlierPacket = await buildMilestoneEvaluationPacket({
      input: earlierDeadlineInput,
      evaluation: earlierResult.evaluation,
      proofGaps: earlierResult.proofGaps,
      generatedAt,
    });
    const laterPacket = await buildMilestoneEvaluationPacket({
      input: laterDeadlineInput,
      evaluation: laterResult.evaluation,
      proofGaps: laterResult.proofGaps,
      generatedAt,
    });

    expect(earlierPacket.milestoneDefinition.dueAt).toBe(earlierDeadlineInput.milestone.dueAt);
    expect(laterPacket.milestoneDefinition.dueAt).toBe(laterDeadlineInput.milestone.dueAt);
    expect(laterPacket.deliverableHashCandidate).not.toBe(earlierPacket.deliverableHashCandidate);
    expect(laterPacket.reasonHashCandidate).not.toBe(earlierPacket.reasonHashCandidate);
  });

  it("binds packet hashes and fields to the exact evaluated evidence input", async () => {
    const scenario = createPawPovAiEvidenceScenario();
    const first = evaluateEvidenceEngine(scenario.initialInput);
    const packet = await buildMilestoneEvaluationPacket({
      input: scenario.initialInput,
      evaluation: first.evaluation,
      proofGaps: first.proofGaps,
      generatedAt,
    });
    expect(packet.milestoneId).toBe(scenario.initialInput.milestone.id);
    expect(packet.verifiedSpend).toEqual(scenario.initialInput.verifiedSpend);

    const changedInput: EvidenceEngineInput = {
      ...scenario.initialInput,
      verifiedSpend: { asset: "USDC", atomicUnits: "151000000" },
    };
    await expect(buildMilestoneEvaluationPacket({
      input: changedInput,
      evaluation: first.evaluation,
      proofGaps: first.proofGaps,
      generatedAt,
    })).rejects.toThrow(/evaluation must match the exact current Evidence Engine input/i);
  });

  it("rejects evaluator packet generation before its evaluation timestamp", async () => {
    const scenario = createPawPovAiEvidenceScenario();
    const first = evaluateEvidenceEngine(scenario.initialInput);
    await expect(buildMilestoneEvaluationPacket({
      input: scenario.initialInput,
      evaluation: first.evaluation,
      proofGaps: first.proofGaps,
      generatedAt: "2026-01-19T23:59:59.000Z",
    })).rejects.toThrow(/generation time cannot precede/i);
  });

  it("changes packet hash candidates when canonical evidence or proof-gap inputs change", async () => {
    const scenario = createPawPovAiEvidenceScenario();
    const first = evaluateEvidenceEngine(scenario.initialInput);
    const initialPacket = await buildMilestoneEvaluationPacket({
      input: scenario.initialInput,
      evaluation: first.evaluation,
      proofGaps: first.proofGaps,
      generatedAt,
    });

    const changedEvidenceInput: EvidenceEngineInput = {
      ...scenario.initialInput,
      evidenceItems: scenario.initialInput.evidenceItems.map((item, index) => index === 0
        ? EvidenceItemSchema.parse({ ...item, sourceHash: `sha256:${"c".repeat(64)}` })
        : item),
    };
    const changedEvidenceResult = evaluateEvidenceEngine(changedEvidenceInput);
    const changedEvidencePacket = await buildMilestoneEvaluationPacket({
      input: changedEvidenceInput,
      evaluation: changedEvidenceResult.evaluation,
      proofGaps: changedEvidenceResult.proofGaps,
      generatedAt,
    });
    expect(changedEvidencePacket.deliverableHashCandidate).not.toBe(initialPacket.deliverableHashCandidate);

    const recovered = applyMissingReceiptRecovery({
      input: scenario.initialInput,
      gap: first.proofGaps[0],
      receipt: scenario.recoveryReceipt,
      acceptedMatch: scenario.recoveryMatch,
      actor: scenario.authorizedFounder,
      resolvedAt,
    });
    const recoveredPacket = await buildMilestoneEvaluationPacket({
      input: recovered.input,
      evaluation: recovered.evaluation,
      proofGaps: [recovered.resolvedGap],
      generatedAt,
    });
    expect(recoveredPacket.reasonHashCandidate).not.toBe(initialPacket.reasonHashCandidate);
  });

  it("rejects stale or unrelated unresolved proof-gap claims", async () => {
    const scenario = createPawPovAiEvidenceScenario();
    const first = evaluateEvidenceEngine(scenario.initialInput);
    await expect(buildMilestoneEvaluationPacket({
      input: scenario.initialInput,
      evaluation: first.evaluation,
      proofGaps: [],
      generatedAt,
    })).rejects.toThrow(/unresolved proof gaps must match/i);

    const unrelatedGap = { ...first.proofGaps[0], milestoneId: "milestone:other" };
    await expect(buildMilestoneEvaluationPacket({
      input: scenario.initialInput,
      evaluation: first.evaluation,
      proofGaps: [unrelatedGap],
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
