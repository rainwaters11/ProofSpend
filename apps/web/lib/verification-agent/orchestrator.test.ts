import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  handoffApprovedProposal,
  resetApprovalHandoffStateForTest,
  runVerificationAgent,
  type AgentModelProvider,
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
  resetApprovalHandoffStateForTest();
});

afterAll(() => {
  process.env.PROOFSPEND_ADAPTER_MODE = ORIGINAL_ENV.PROOFSPEND_ADAPTER_MODE;
  process.env.PROOFSPEND_AGENT_MODE = ORIGINAL_ENV.PROOFSPEND_AGENT_MODE;
  process.env.OPENAI_API_KEY = ORIGINAL_ENV.OPENAI_API_KEY;
  process.env.LLM_MODEL = ORIGINAL_ENV.LLM_MODEL;
});

describe("runVerificationAgent", () => {
  it("runs the seeded happy path and stops at APPROVAL_REQUIRED", async () => {
    const result = await runVerificationAgent({
      now: "2026-01-21T00:00:00.000Z",
    });

    expect(result.status).toBe("APPROVAL_REQUIRED");
    expect(result.agentMode).toBe("mock");
    expect(result.adapterMode).toBe("mock");
    expect(result.proposal.amount.atomicUnits).toBe("250000000");
    expect(result.missingReceiptQuestion).toContain("receipt");

    const codes = result.activityTrace.map((event) => event.code);
    expect(codes).toEqual([
      "RUN_STARTED",
      "MILESTONE_EVALUATED",
      "PROOF_GAP_FOUND",
      "EVIDENCE_ANALYZED",
      "RECOVERY_QUESTION_ASKED",
      "FOUNDER_CORRECTION_ACCEPTED",
      "MILESTONE_REEVALUATED",
      "PROPOSAL_PREPARED",
      "APPROVAL_REQUIRED",
      "HANDOFF_READY",
    ]);
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
    const overreachProvider: AgentModelProvider = {
      async analyzeMissingReceipt() {
        return {
          missingGapId: "proof-gap:milestone:launch-ready:missing-receipt",
          question: "Please add the missing receipt required for this milestone.",
          summary: "Attempting forbidden action",
          // @ts-expect-error: explicit invalid action to verify strict boundary
          requestedAction: "SUBMIT_TRANSACTION",
        };
      },
    };

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
    const run = await runVerificationAgent({
      now: "2026-01-21T00:00:00.000Z",
    });

    const result = handoffApprovedProposal({
      run,
      approval: {
        approvalId: "approval:1",
        intentId: run.proposal.intentId,
        authorizedActorRole: "FOUNDER",
        authorizedActorId: "founder:fictional",
        decision: "APPROVED",
        decidedAt: "2026-01-21T00:00:00.000Z",
        expiresAt: "2026-01-21T00:00:01.000Z",
        idempotencyKey: "approval:key:1",
      },
      now: "2026-01-21T00:00:02.000Z",
    });

    expect(result.status).toBe("HANDOFF_REJECTED");
    expect(result.execution.transactionHash).toBeNull();
  });

  it("applies idempotency duplicate protection for repeated approvals", async () => {
    const run = await runVerificationAgent({
      now: "2026-01-21T00:00:00.000Z",
    });

    const approval = {
      approvalId: "approval:repeat",
      intentId: run.proposal.intentId,
      authorizedActorRole: "FOUNDER" as const,
      authorizedActorId: "founder:fictional",
      decision: "APPROVED" as const,
      decidedAt: "2026-01-21T00:00:00.000Z",
      expiresAt: "2026-01-22T00:00:00.000Z",
      idempotencyKey: "approval:key:repeat",
    };

    const first = handoffApprovedProposal({ run, approval, now: "2026-01-21T00:00:01.000Z" });
    const duplicate = handoffApprovedProposal({
      run,
      approval,
      now: "2026-01-21T00:00:02.000Z",
    });

    expect(first.status).toBe("HANDOFF_READY");
    expect(duplicate.status).toBe("HANDOFF_REJECTED");
  });
});
