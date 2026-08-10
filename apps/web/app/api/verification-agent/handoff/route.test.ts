import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as verificationAgent from "@/lib/verification-agent";

vi.mock("@/lib/verification-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/verification-agent")>();
  return {
    ...actual,
    executeLiveCircleHandoff: vi.fn(actual.executeLiveCircleHandoff),
    recoverPersistedLiveCircleHandoff: vi.fn(
      actual.recoverPersistedLiveCircleHandoff,
    ),
  };
});

import {
  MAX_HANDOFF_ATTEMPTS_PER_RUN,
  loadVerificationAgentRun,
  persistApprovedHandoff,
  reserveApprovedHandoff,
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
  CIRCLE_API_KEY: process.env.CIRCLE_API_KEY,
  CIRCLE_ENTITY_SECRET: process.env.CIRCLE_ENTITY_SECRET,
  CIRCLE_SOURCE_WALLET_ID: process.env.CIRCLE_SOURCE_WALLET_ID,
  CIRCLE_DESTINATION_WALLET_ID: process.env.CIRCLE_DESTINATION_WALLET_ID,
  CIRCLE_DESTINATION_WALLET_ADDRESS: process.env.CIRCLE_DESTINATION_WALLET_ADDRESS,
  CIRCLE_CHAIN: process.env.CIRCLE_CHAIN,
  CIRCLE_USDC_TOKEN_ADDRESS: process.env.CIRCLE_USDC_TOKEN_ADDRESS,
  CIRCLE_POLL_INTERVAL_MS: process.env.CIRCLE_POLL_INTERVAL_MS,
  CIRCLE_MAX_POLLS: process.env.CIRCLE_MAX_POLLS,
  CIRCLE_ARGSCAN_BASE_URL: process.env.CIRCLE_ARGSCAN_BASE_URL,
  PROOFSPEND_AUTH_STORE_PATH: process.env.PROOFSPEND_AUTH_STORE_PATH,
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
    process.env.CIRCLE_API_KEY = original.CIRCLE_API_KEY;
    process.env.CIRCLE_ENTITY_SECRET = original.CIRCLE_ENTITY_SECRET;
    process.env.CIRCLE_SOURCE_WALLET_ID = original.CIRCLE_SOURCE_WALLET_ID;
    process.env.CIRCLE_DESTINATION_WALLET_ID = original.CIRCLE_DESTINATION_WALLET_ID;
    process.env.CIRCLE_DESTINATION_WALLET_ADDRESS = original.CIRCLE_DESTINATION_WALLET_ADDRESS;
    process.env.CIRCLE_CHAIN = original.CIRCLE_CHAIN;
    process.env.CIRCLE_USDC_TOKEN_ADDRESS = original.CIRCLE_USDC_TOKEN_ADDRESS;
    process.env.CIRCLE_POLL_INTERVAL_MS = original.CIRCLE_POLL_INTERVAL_MS;
    process.env.CIRCLE_MAX_POLLS = original.CIRCLE_MAX_POLLS;
    process.env.CIRCLE_ARGSCAN_BASE_URL = original.CIRCLE_ARGSCAN_BASE_URL;
    process.env.PROOFSPEND_AUTH_STORE_PATH = original.PROOFSPEND_AUTH_STORE_PATH;
    vi.restoreAllMocks();
    vi.mocked(verificationAgent.executeLiveCircleHandoff).mockReset();
    vi.mocked(verificationAgent.recoverPersistedLiveCircleHandoff).mockReset();
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
          exactIntentHash: run.proposal.exactIntentHash,
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

  it("routes a restart through durable recovery when the transient run map is empty", async () => {
    configureLiveEnvironment();
    const runId = "run:restarted";
    const approval = {
      approvalId: "approval:restarted",
      intentId: "intent:release:pawpovai:milestone-launch-ready",
      authorizedActorRole: "FOUNDER" as const,
      authorizedActorId: "founder:fictional",
      decision: "APPROVED" as const,
      decidedAt: "2026-08-09T00:01:01.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      idempotencyKey: "release:restarted",
      exactIntentHash: `sha256:${"1a".repeat(32)}`,
    };
    const recovered = {
      status: "HANDOFF_CONFIRMED" as const,
      adapterMode: "arc-testnet" as const,
      execution: {
        state: "CONFIRMED" as const,
        idempotencyKey: approval.idempotencyKey,
        providerOperationId: "11111111-1111-4111-8111-111111111111",
        transactionHash: `0x${"2b".repeat(32)}`,
        confirmation: "ARC_TESTNET_CONFIRMED",
        explorerUrl: `https://testnet.arcscan.app/tx/0x${"2b".repeat(32)}`,
        reconciliation: {
          state: "RECONCILED" as const,
          reconciliationId: "reconciliation:transaction:run:restarted",
          reconciledAt: "2026-08-09T00:02:00.000Z",
        },
        failureCode: null,
        failureMessage: null,
      },
      activityTrace: [
        {
          id: "run:restarted:handoff:0:confirmed",
          at: "2026-08-09T00:01:04.000Z",
          layer: "ARC TESTNET" as const,
          code: "TRANSACTION_CONFIRMED" as const,
          message: "Arc Testnet confirmed the real 1 USDC transfer.",
        },
      ],
    };
    const recoverySpy = vi
      .mocked(verificationAgent.recoverPersistedLiveCircleHandoff)
      .mockResolvedValue(recovered);

    const response = await POST(handoffRequest(runId, approval));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(recovered);
    expect(recoverySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        approval,
        authenticatedActorId: "founder:fictional",
      }),
    );
    expect(verificationAgent.executeLiveCircleHandoff).not.toHaveBeenCalled();
  });

  it("rejects an altered approval before starting uncertain live recovery", async () => {
    const runResponse = await runAgent(
      new Request("http://localhost/api/verification-agent/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      }),
    );
    const run = await submitFounderCorrection(await runResponse.json());
    const approval = {
      approvalId: "approval:recovery",
      intentId: run.proposal.intentId,
      authorizedActorRole: "FOUNDER" as const,
      authorizedActorId: "founder:fictional",
      decision: "APPROVED" as const,
      decidedAt: new Date().toISOString(),
      expiresAt: run.proposal.expiresAt,
      idempotencyKey: run.proposal.idempotencyKey,
      exactIntentHash: run.proposal.exactIntentHash,
    };
    expect(
      reserveApprovedHandoff({ runId: run.runId, approval }),
    ).toBe(true);
    expect(
      persistApprovedHandoff({
        runId: run.runId,
        approval,
        result: {
          status: "HANDOFF_SUBMITTED",
          adapterMode: "arc-testnet",
          execution: {
            state: "SUBMITTED",
            providerOperationId: "operation:uncertain",
            transactionHash: null,
            confirmation: null,
            explorerUrl: null,
          },
          activityTrace: run.activityTrace,
        },
      }),
    ).toBe(true);

    configureLiveEnvironment();
    const executeSpy = vi.mocked(verificationAgent.executeLiveCircleHandoff);

    const response = await POST(
      new Request("http://localhost/api/verification-agent/handoff", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          runId: run.runId,
          approval: {
            ...approval,
            expiresAt: new Date(Date.parse(approval.expiresAt) - 1_000).toISOString(),
          },
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "HANDOFF_DUPLICATE" });
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("serializes overlapping approvals before either can start recovery", async () => {
    const runResponse = await runAgent(
      new Request("http://localhost/api/verification-agent/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      }),
    );
    const run = await submitFounderCorrection(await runResponse.json());
    const approval = {
      approvalId: "approval:overlap",
      intentId: run.proposal.intentId,
      authorizedActorRole: "FOUNDER" as const,
      authorizedActorId: "founder:fictional",
      decision: "APPROVED" as const,
      decidedAt: new Date().toISOString(),
      expiresAt: run.proposal.expiresAt,
      idempotencyKey: run.proposal.idempotencyKey,
      exactIntentHash: run.proposal.exactIntentHash,
    };
    configureLiveEnvironment();

    let resolveExecution!: (value: Awaited<
      ReturnType<typeof verificationAgent.executeLiveCircleHandoff>
    >) => void;
    const execution = new Promise<
      Awaited<ReturnType<typeof verificationAgent.executeLiveCircleHandoff>>
    >((resolve) => {
      resolveExecution = resolve;
    });
    const executeSpy = vi
      .mocked(verificationAgent.executeLiveCircleHandoff)
      .mockReturnValue(execution);

    const firstResponse = POST(handoffRequest(run.runId, approval));
    await vi.waitFor(() => expect(executeSpy).toHaveBeenCalledTimes(1));

    const overlappingResponse = await POST(
      handoffRequest(run.runId, {
        ...approval,
        expiresAt: new Date(Date.parse(approval.expiresAt) - 1_000).toISOString(),
      }),
    );

    expect(overlappingResponse.status).toBe(409);
    await expect(overlappingResponse.json()).resolves.toEqual({
      error: "HANDOFF_DUPLICATE",
    });
    expect(executeSpy).toHaveBeenCalledTimes(1);

    resolveExecution({
      status: "HANDOFF_SUBMITTED",
      adapterMode: "arc-testnet",
      execution: {
        state: "SUBMITTED",
        providerOperationId: "11111111-1111-4111-8111-111111111111",
        transactionHash: null,
        confirmation: null,
        explorerUrl: null,
      },
      activityTrace: run.activityTrace,
    });
    expect((await firstResponse).status).toBe(200);
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
          exactIntentHash: run.proposal.exactIntentHash,
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
        headers: { Authorization: "Bearer " + API_TOKEN },
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
        headers: { Authorization: "Bearer " + API_TOKEN },
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
        body: JSON.stringify({ runId: run.runId }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects oversized approval identifiers before retaining an attempt", async () => {
    const runResponse = await runAgent(
      new Request("http://localhost/api/verification-agent/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      }),
    );
    const run = await submitFounderCorrection(await runResponse.json());
    const response = await POST(
      new Request("http://localhost/api/verification-agent/handoff", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          runId: run.runId,
          approval: {
            approvalId: "a".repeat(201),
            intentId: run.proposal.intentId,
            authorizedActorRole: "FOUNDER",
            authorizedActorId: "founder:fictional",
            decision: "APPROVED",
            decidedAt: new Date().toISOString(),
            expiresAt: run.proposal.expiresAt,
            idempotencyKey: run.proposal.idempotencyKey,
            exactIntentHash: run.proposal.exactIntentHash,
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(loadVerificationAgentRun(run.runId)?.handoffAttempts).toHaveLength(0);
  });

  it("preserves the original audit entries and rejects attempts over budget", async () => {
    const runResponse = await runAgent(
      new Request("http://localhost/api/verification-agent/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      }),
    );
    const run = await submitFounderCorrection(await runResponse.json());

    const submitRejectedHandoff = (index: number) => {
      const suffix = index.toString().padStart(4, "0");
      return POST(
        new Request("http://localhost/api/verification-agent/handoff", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            runId: run.runId,
            approval: {
              approvalId: `approval:rejected:${suffix}`,
              intentId: `intent:wrong:${suffix}`,
              authorizedActorRole: "FOUNDER",
              authorizedActorId: "founder:fictional",
              decision: "APPROVED",
              decidedAt: new Date().toISOString(),
              expiresAt: run.proposal.expiresAt,
              idempotencyKey: run.proposal.idempotencyKey,
              exactIntentHash: run.proposal.exactIntentHash,
            },
          }),
        }),
      );
    };

    for (let index = 0; index < MAX_HANDOFF_ATTEMPTS_PER_RUN; index += 1) {
      const response = await submitRejectedHandoff(index);
      expect(response.status).toBe(422);
    }

    for (
      let index = MAX_HANDOFF_ATTEMPTS_PER_RUN;
      index < MAX_HANDOFF_ATTEMPTS_PER_RUN + 5;
      index += 1
    ) {
      const response = await submitRejectedHandoff(index);
      expect(response.status).toBe(429);
      await expect(response.json()).resolves.toEqual({
        error: "HANDOFF_ATTEMPT_LIMIT_REACHED",
      });
    }

    const attempts = loadVerificationAgentRun(run.runId)?.handoffAttempts ?? [];
    expect(attempts).toHaveLength(MAX_HANDOFF_ATTEMPTS_PER_RUN);
    expect(attempts[0]?.approval.approvalId).toBe("approval:rejected:0000");
    expect(attempts.at(-1)?.approval.approvalId).toBe("approval:rejected:0019");
  });
});

function configureLiveEnvironment() {
  process.env.PROOFSPEND_ADAPTER_MODE = "arc-testnet";
  process.env.PROOFSPEND_AGENT_MODE = "openai";
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.LLM_MODEL = "gpt-test";
  process.env.CIRCLE_API_KEY = "test-circle-key";
  process.env.CIRCLE_ENTITY_SECRET = "a".repeat(64);
  process.env.CIRCLE_SOURCE_WALLET_ID = "11111111-1111-4111-8111-111111111111";
  process.env.CIRCLE_DESTINATION_WALLET_ID = "22222222-2222-4222-8222-222222222222";
  process.env.CIRCLE_DESTINATION_WALLET_ADDRESS =
    "0x1111111111111111111111111111111111111111";
  process.env.CIRCLE_CHAIN = "ARC-TESTNET";
  process.env.CIRCLE_USDC_TOKEN_ADDRESS =
    "0x3600000000000000000000000000000000000000";
  process.env.CIRCLE_POLL_INTERVAL_MS = "1";
  process.env.CIRCLE_MAX_POLLS = "1";
  process.env.CIRCLE_ARGSCAN_BASE_URL = "https://testnet.arcscan.app";
  process.env.PROOFSPEND_AUTH_STORE_PATH = "/tmp/proofspend-route-test.json";
}

function handoffRequest(runId: string, approval: Record<string, unknown>) {
  return new Request("http://localhost/api/verification-agent/handoff", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ runId, approval }),
  });
}

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
