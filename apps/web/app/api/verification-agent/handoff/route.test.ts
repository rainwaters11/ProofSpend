import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadVerificationAgentRun,
  resetAgentApiAccessForTest,
  resetVerificationAgentStoreForTest,
} from "@/lib/verification-agent";

import { POST } from "./route";
import { POST as runAgent } from "../run/route";
import { POST as submitCorrection } from "../correction/route";

const API_TOKEN = "test-agent-api-token-that-is-at-least-32-chars";

const original = {
  PROOFSPEND_ADAPTER_MODE: process.env.PROOFSPEND_ADAPTER_MODE,
  PROOFSPEND_AGENT_MODE: process.env.PROOFSPEND_AGENT_MODE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
  PROOFSPEND_AGENT_API_TOKEN: process.env.PROOFSPEND_AGENT_API_TOKEN,
};

describe("POST /api/verification-agent/handoff", () => {
  beforeEach(() => {
    process.env.PROOFSPEND_ADAPTER_MODE = "mock";
    process.env.PROOFSPEND_AGENT_MODE = "mock";
    process.env.PROOFSPEND_AGENT_API_TOKEN = API_TOKEN;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_MODEL;
    resetAgentApiAccessForTest();
    resetVerificationAgentStoreForTest();
  });

  afterEach(() => {
    process.env.PROOFSPEND_ADAPTER_MODE = original.PROOFSPEND_ADAPTER_MODE;
    process.env.PROOFSPEND_AGENT_MODE = original.PROOFSPEND_AGENT_MODE;
    process.env.OPENAI_API_KEY = original.OPENAI_API_KEY;
    process.env.LLM_MODEL = original.LLM_MODEL;
    process.env.PROOFSPEND_AGENT_API_TOKEN = original.PROOFSPEND_AGENT_API_TOKEN;
  });

  it("accepts valid approval handoff and keeps mock execution truthful", async () => {
    const runResponse = await runAgent(
      new Request("http://localhost/api/verification-agent/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      }),
    );
    const initialRun = await runResponse.json();
    const run = await submitFounderCorrection(initialRun);
    const decidedAt = new Date().toISOString();
    const request = new Request("http://localhost/api/verification-agent/handoff", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        runId: run.runId,
        approval: {
          approvalId: "approval:test",
          intentId: "intent:release:pawpovai:milestone-launch-ready",
          authorizedActorRole: "FOUNDER",
          authorizedActorId: "founder:fictional",
          decision: "APPROVED",
          decidedAt,
          expiresAt: run.proposal.expiresAt,
          idempotencyKey: run.proposal.idempotencyKey,
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
    expect(loadVerificationAgentRun(run.runId)?.handoff).toMatchObject({
      approval: { approvalId: "approval:test" },
      result: { status: "HANDOFF_READY" },
    });
  });

  it("does not accept client-supplied run state", async () => {
    const runResponse = await runAgent(
      new Request("http://localhost/api/verification-agent/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      }),
    );
    const initialRun = await runResponse.json();
    const run = await submitFounderCorrection(initialRun);
    const decidedAt = new Date().toISOString();
    const request = new Request("http://localhost/api/verification-agent/handoff", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        run: {
          ...run,
          proposal: {
            ...run.proposal,
            amount: { asset: "USDC", atomicUnits: "999999999" },
          },
        },
        runId: run.runId,
        approval: {
          approvalId: "approval:forged-run",
          intentId: run.proposal.intentId,
          authorizedActorRole: "FOUNDER",
          authorizedActorId: "founder:fictional",
          decision: "APPROVED",
          decidedAt,
          expiresAt: run.proposal.expiresAt,
          idempotencyKey: run.proposal.idempotencyKey,
        },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("rejects client-supplied correction evidence", async () => {
    const runResponse = await runAgent(
      new Request("http://localhost/api/verification-agent/run", {
        method: "POST",
        headers: { Authorization: `****** },
      }),
    );
    const run = await runResponse.json();
    const response = await submitCorrection(
      new Request("http://localhost/api/verification-agent/correction", {
        method: "POST",
        headers: new Headers({
          Authorization: "Bearer " + API_TOKEN,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          runId: run.runId,
          receipt: { sourceHash: `sha256:${"0".repeat(64)}` },
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("requires an explicit founder confirmation before applying the seeded correction", async () => {
    const runResponse = await runAgent(
      new Request("http://localhost/api/verification-agent/run", {
        method: "POST",
        headers: { Authorization: `****** },
      }),
    );
    const run = await runResponse.json();
    const response = await submitCorrection(
      new Request("http://localhost/api/verification-agent/correction", {
        method: "POST",
        headers: new Headers({
          Authorization: `******
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ runId: run.runId }),
      }),
    );

    expect(response.status).toBe(400);
  });
});

async function submitFounderCorrection(run: { runId: string }) {
  const response = await submitCorrection(
    new Request("http://localhost/api/verification-agent/correction", {
      method: "POST",
      headers: new Headers({
        Authorization: "Bearer " + API_TOKEN,
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        runId: run.runId,
        confirmSeededCorrection: true,
      }),
    }),
  );
  expect(response.status).toBe(200);
  return response.json();
}
