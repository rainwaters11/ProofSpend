import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createPawPovAiEvidenceScenario } from "@proofspend/domain";
import {
  handoffApprovedProposal,
  persistApprovedHandoff,
  resetVerificationAgentStoreForTest,
  resumeVerificationAgentAfterFounderCorrection,
  runVerificationAgent,
  saveVerificationAgentRun,
  type AgentModelProvider,
  type MissingReceiptModelOutput,
} from "./index";

const ORIGINAL_ENV = {
  PROOFSPEND_ADAPTER_MODE: process.env.PROOFSPEND_ADAPTER_MODE,
  PROOFSPEND_AGENT_MODE: process.env.PROOFSPEND_AGENT_MODE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
};

beforeEach(() => {
  process.env.PROOFSPEND_ADAPTER_MODE = "mock";
  process.env.PROOFSPEND_AGENT_MODE = "mock";
  delete process.env.OPENAI_API_KEY;
  delete process.env.LLM_MODEL;
  resetVerificationAgentStoreForTest();
});

afterAll(() => {
  process.env.PROOFSPEND_ADAPTER_MODE = ORIGINAL_ENV.PROOFSPEND_ADAPTER_MODE;
  process.env.PROOFSPEND_AGENT_MODE = ORIGINAL_ENV.PROOFSPEND_AGENT_MODE;
  process.env.OPENAI_API_KEY = ORIGINAL_ENV.OPENAI_API_KEY;
  process.env.LLM_MODEL = ORIGINAL_ENV.LLM_MODEL;
});

describe("runVerificationAgent", () => {
  it("pauses for a separately authenticated founder correction", async () => {
    const result = await runVerificationAgent({
      now: "2026-01-21T00:00:00.000Z",
    });

    expect(result.status).toBe("CORRECTION_REQUIRED");
    expect(result.agentMode).toBe("mock");
    expect(result.adapterMode).toBe("mock");
    expect(result.proposal).toBeNull();
    expect(result.missingReceiptQuestion).toContain("receipt");

    const codes = result.activityTrace.map((event) => event.code);
    expect(codes).toEqual([
      "RUN_STARTED",
      "MILESTONE_EVALUATED",
      "PROOF_GAP_FOUND",
      "EVIDENCE_ANALYZED",
      "RECOVERY_QUESTION_ASKED",
      "FOUNDER_CORRECTION_REQUIRED",
    ]);
  });

  it("accepts a validated founder correction before preparing a proposal", async () => {
    const initial = await runVerificationAgent({ now: "2026-01-21T00:00:00.000Z" });
    const scenario = createPawPovAiEvidenceScenario();
    const result = resumeVerificationAgentAfterFounderCorrection({
      run: initial,
      authenticatedActorId: "founder:fictional",
      receipt: scenario.recoveryReceipt,
      acceptedMatch: scenario.recoveryMatch,
      now: "2026-01-21T00:01:00.000Z",
    });

    expect(result.status).toBe("APPROVAL_REQUIRED");
    expect(result.proposal?.amount.atomicUnits).toBe("250000000");
    expect(result.activityTrace.map((event) => event.code)).toContain(
      "FOUNDER_CORRECTION_ACCEPTED",
    );
  });

  it("rejects invalid model output", async () => {
    const invalidProvider: AgentModelProvider = {
      async analyzeMissingReceipt() {
        return {
          missingGapId: "wrong-gap",
          question: "Please add the missing receipt required for this milestone.",
          summary: "bad",
          requestedAction: "ASK_PROOF_RECOVERY_QUESTION",
        };
      },
    };

    await expect(
      runVerificationAgent({
        provider: invalidProvider,
      }),
    ).rejects.toThrow("AGENT_MODEL_GAP_MISMATCH");
  });

  it("rejects attempted tool overreach or direct submission intent from model", async () => {
    const overreachProvider = {
      async analyzeMissingReceipt() {
        return {
          missingGapId: "proof-gap:milestone:launch-ready:missing-receipt",
          question: "Please add the missing receipt required for this milestone.",
          summary: "Attempting forbidden action",
          requestedAction: "SUBMIT_TRANSACTION",
        } as unknown as MissingReceiptModelOutput;
      },
    } as unknown as AgentModelProvider;

    await expect(
      runVerificationAgent({
        provider: overreachProvider,
      }),
    ).rejects.toThrow();
  });

  it("fails closed on provider failure in openai mode with no fallback", async () => {
    process.env.PROOFSPEND_AGENT_MODE = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.LLM_MODEL = "gpt-5-mini";

    const failingProvider: AgentModelProvider = {
      async analyzeMissingReceipt() {
        throw new Error("AGENT_PROVIDER_FAILURE");
      },
    };

    await expect(runVerificationAgent({ provider: failingProvider })).rejects.toThrow(
      "AGENT_PROVIDER_FAILURE",
    );
  });

  it("redacts hashes, private evidence references, and secrets from trace text", async () => {
    const provider: AgentModelProvider = {
      async analyzeMissingReceipt() {
        return {
          missingGapId: "proof-gap:milestone:launch-ready:missing-receipt",
          question:
            "Please add receipt for private://folder/file linked to sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa using sk-secret",
          summary:
            "Found missing receipt at private://evidence/location sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          requestedAction: "ASK_PROOF_RECOVERY_QUESTION",
        };
      },
    };

    const result = await runVerificationAgent({ provider });
    const joined = result.activityTrace.map((event) => event.message).join(" ");

    expect(joined).not.toContain("private://");
    expect(joined).not.toContain("sha256:");
    expect(joined).not.toContain("sk-");
  });
});

describe("handoffApprovedProposal", () => {
  it("rejects missing or stale approval handoff", async () => {
    const run = await createApprovalRun();

    const result = handoffApprovedProposal({
      run,
      approval: {
        approvalId: "approval:1",
        intentId: run.proposal!.intentId,
        authorizedActorRole: "FOUNDER",
        authorizedActorId: "founder:fictional",
        decision: "APPROVED",
        decidedAt: "2026-01-21T00:00:00.000Z",
        expiresAt: "2026-01-21T00:00:01.000Z",
        idempotencyKey: run.proposal!.idempotencyKey,
      },
      authenticatedActorId: "founder:fictional",
      now: "2026-01-21T00:00:02.000Z",
    });

    expect(result.status).toBe("HANDOFF_REJECTED");
    expect(result.execution.transactionHash).toBeNull();
  });

  it("applies idempotency duplicate protection for repeated approvals", async () => {
    const run = await createApprovalRun();

    const approval = {
      approvalId: "approval:repeat",
      intentId: run.proposal!.intentId,
      authorizedActorRole: "FOUNDER" as const,
      authorizedActorId: "founder:fictional",
      decision: "APPROVED" as const,
      decidedAt: "2026-01-21T00:00:00.000Z",
      expiresAt: run.proposal!.expiresAt,
      idempotencyKey: run.proposal!.idempotencyKey,
    };

    saveVerificationAgentRun({ authorizedActorId: "founder:fictional", run });
    const first = handoffApprovedProposal({
      run,
      approval,
      authenticatedActorId: "founder:fictional",
      now: "2026-01-21T00:00:01.000Z",
    });

    expect(first.status).toBe("HANDOFF_READY");
    expect(
      persistApprovedHandoff({
        runId: run.runId,
        approval,
        result: first,
      }),
    ).toBe(true);
    expect(
      persistApprovedHandoff({
        runId: run.runId,
        approval: { ...approval, approvalId: "approval:changed" },
        result: first,
      }),
    ).toBe(false);
  });

  it("rejects an approval that attempts to extend an expired proposal", async () => {
    const run = await createApprovalRun();
    const result = handoffApprovedProposal({
      run,
      approval: {
        approvalId: "approval:late",
        intentId: run.proposal!.intentId,
        authorizedActorRole: "FOUNDER",
        authorizedActorId: "founder:fictional",
        decision: "APPROVED",
        decidedAt: "2026-01-21T00:16:00.000Z",
        expiresAt: "2026-01-21T01:00:00.000Z",
        idempotencyKey: run.proposal!.idempotencyKey,
      },
      authenticatedActorId: "founder:fictional",
      now: "2026-01-21T00:16:00.000Z",
    });

    expect(result.status).toBe("HANDOFF_REJECTED");
  });
});

async function createApprovalRun() {
  const initial = await runVerificationAgent({ now: "2026-01-21T00:00:00.000Z" });
  const scenario = createPawPovAiEvidenceScenario();
  return resumeVerificationAgentAfterFounderCorrection({
    run: initial,
    authenticatedActorId: "founder:fictional",
    receipt: scenario.recoveryReceipt,
    acceptedMatch: scenario.recoveryMatch,
    now: "2026-01-21T00:01:00.000Z",
  });
}
