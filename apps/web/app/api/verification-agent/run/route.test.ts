import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "./route";

const original = {
  PROOFSPEND_ADAPTER_MODE: process.env.PROOFSPEND_ADAPTER_MODE,
  PROOFSPEND_AGENT_MODE: process.env.PROOFSPEND_AGENT_MODE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
};

describe("POST /api/verification-agent/run", () => {
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

  it("returns sanitized approval-required run output", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.status).toBe("APPROVAL_REQUIRED");
    expect(json.proposal.amount.atomicUnits).toBe("250000000");
    expect(Array.isArray(json.activityTrace)).toBe(true);
  });
});
