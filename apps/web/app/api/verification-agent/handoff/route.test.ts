import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runVerificationAgent } from "@/lib/verification-agent";

import { POST } from "./route";

const original = {
  PROOFSPEND_ADAPTER_MODE: process.env.PROOFSPEND_ADAPTER_MODE,
  PROOFSPEND_AGENT_MODE: process.env.PROOFSPEND_AGENT_MODE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
};

describe("POST /api/verification-agent/handoff", () => {
  beforeEach(() => {
    process.env.PROOFSPEND_ADAPTER_MODE = "mock";
    process.env.PROOFSPEND_AGENT_MODE = "mock";
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    process.env.PROOFSPEND_ADAPTER_MODE = original.PROOFSPEND_ADAPTER_MODE;
    process.env.PROOFSPEND_AGENT_MODE = original.PROOFSPEND_AGENT_MODE;
    process.env.OPENAI_API_KEY = original.OPENAI_API_KEY;
    process.env.LLM_MODEL = original.LLM_MODEL;
  });

  it("accepts valid approval handoff and keeps mock execution truthful", async () => {
    const run = await runVerificationAgent({ now: "2026-01-21T00:00:00.000Z" });
    const request = new Request("http://localhost/api/verification-agent/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        run,
        approval: {
          approvalId: "approval:test",
          intentId: "intent:release:pawpovai:milestone-launch-ready",
          authorizedActorRole: "FOUNDER",
          authorizedActorId: "founder:fictional",
          decision: "APPROVED",
          decidedAt: "2026-01-21T00:00:00.000Z",
          expiresAt: "2027-02-01T00:00:00.000Z",
          idempotencyKey: "approval:test:key",
        },
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.status).toBe("HANDOFF_READY");
    expect(json.execution.transactionHash).toBeNull();
    expect(json.execution.confirmation).toBeNull();
    expect(json.execution.explorerUrl).toBeNull();
  });
});
