import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ApprovedTransferIntent,
  ArcTestnetTransferProvider,
  TransferResult,
} from "@proofspend/circle-adapter";
import { createPawPovAiEvidenceScenario } from "@proofspend/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resumeVerificationAgentAfterFounderCorrection,
  runVerificationAgent,
} from "./orchestrator";
import { FileTransferAuthorizationStore } from "./durable-authorization-store";
import { executeLiveCircleHandoff } from "./live-handoff";

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("executeLiveCircleHandoff", () => {
  it("binds exactly 1 USDC and records a truthful confirmed result", async () => {
    const context = await liveContext();
    const seen: ApprovedTransferIntent[] = [];
    const provider = fakeProvider(seen);

    const result = await executeLiveCircleHandoff({
      run: context.run,
      approval: context.approval,
      environment: context.environment,
      initialActivityTrace: context.run.activityTrace,
      dependencies: {
        store: context.store,
        providerFactory: () => provider,
      },
    });

    expect(seen).toHaveLength(3);
    expect(seen.every((intent) => intent.amountAtomic === "1000000")).toBe(true);
    expect(seen.every((intent) => intent.sourceWalletId === context.environment.CIRCLE_SOURCE_WALLET_ID)).toBe(true);
    expect(seen.every((intent) => intent.destinationAddress === context.environment.CIRCLE_DESTINATION_WALLET_ADDRESS)).toBe(true);
    expect(result).toMatchObject({
      status: "HANDOFF_CONFIRMED",
      execution: {
        state: "CONFIRMED",
        transactionHash: `0x${"1a".repeat(32)}`,
        explorerUrl: `https://testnet.arcscan.app/tx/0x${"1a".repeat(32)}`,
      },
    });
    expect(result.activityTrace.map((event) => event.code)).toEqual(
      expect.arrayContaining([
        "TRANSACTION_PREPARED",
        "TRANSACTION_SUBMITTED",
        "TRANSACTION_CONFIRMED",
      ]),
    );
  });

  it("rejects a replay from a new store instance before provider submission", async () => {
    const context = await liveContext();
    const firstProvider = fakeProvider([]);
    await executeLiveCircleHandoff({
      run: context.run,
      approval: context.approval,
      environment: context.environment,
      initialActivityTrace: context.run.activityTrace,
      dependencies: { store: context.store, providerFactory: () => firstProvider },
    });

    const providerFactory = vi.fn(() => fakeProvider([]));
    await expect(
      executeLiveCircleHandoff({
        run: context.run,
        approval: context.approval,
        environment: context.environment,
        initialActivityTrace: context.run.activityTrace,
        dependencies: {
          store: new FileTransferAuthorizationStore(context.environment.PROOFSPEND_AUTH_STORE_PATH),
          providerFactory,
        },
      }),
    ).rejects.toThrow("HANDOFF_DUPLICATE");
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("fails closed and never fabricates a transaction hash when the provider rejects", async () => {
    const context = await liveContext();
    const provider = fakeProvider([], {
      prepareTransfer: async () => {
        throw new Error("provider unavailable");
      },
    });

    const result = await executeLiveCircleHandoff({
      run: context.run,
      approval: context.approval,
      environment: context.environment,
      initialActivityTrace: context.run.activityTrace,
      dependencies: { store: context.store, providerFactory: () => provider },
    });

    expect(result).toMatchObject({
      status: "HANDOFF_FAILED",
      execution: {
        state: "FAILED",
        transactionHash: null,
        explorerUrl: null,
      },
    });
  });

  it("retains the Circle operation id when polling fails after submission", async () => {
    const context = await liveContext();
    const provider = fakeProvider([], {
      pollTransfer: async () => {
        throw new Error("poll unavailable");
      },
    });

    const result = await executeLiveCircleHandoff({
      run: context.run,
      approval: context.approval,
      environment: context.environment,
      initialActivityTrace: context.run.activityTrace,
      dependencies: { store: context.store, providerFactory: () => provider },
    });

    expect(result).toMatchObject({
      status: "HANDOFF_FAILED",
      execution: {
        state: "FAILED",
        providerOperationId: "11111111-1111-4111-8111-111111111111",
        transactionHash: null,
      },
    });
  });
});

function fakeProvider(
  seen: ApprovedTransferIntent[],
  overrides: Partial<ArcTestnetTransferProvider> = {},
): ArcTestnetTransferProvider {
  const operationId = "11111111-1111-4111-8111-111111111111";
  const transactionHash = `0x${"1a".repeat(32)}`;
  const result = (intent: ApprovedTransferIntent, status: TransferResult["status"]): TransferResult => ({
    proposalId: intent.proposalId,
    idempotencyKey: intent.idempotencyKey,
    mode: "ARC_TESTNET",
    status,
    providerOperationId: status === "PREPARED" ? undefined : operationId,
    transactionHash: status === "CONFIRMED" ? transactionHash : undefined,
    explorerUrl:
      status === "CONFIRMED"
        ? `https://testnet.arcscan.app/tx/${transactionHash}`
        : undefined,
    polledAt: "2026-08-09T00:01:02.000Z",
  });
  return {
    async getStatus() {
      return { mode: "ARC_TESTNET", state: "ready" };
    },
    async getBalance() {
      return { asset: "USDC", amountAtomic: "20000000" };
    },
    async prepareTransfer(intent) {
      seen.push(intent);
      return result(intent, "PREPARED");
    },
    async submitTransfer(intent) {
      seen.push(intent);
      return result(intent, "SUBMITTED");
    },
    async pollTransfer(intent) {
      seen.push(intent);
      return result(intent, "CONFIRMED");
    },
    ...overrides,
  };
}

async function liveContext() {
  const directory = await mkdtemp(join(tmpdir(), "proofspend-live-handoff-"));
  directories.push(directory);
  const environment = {
    OPENAI_API_KEY: "sk-test",
    LLM_MODEL: "gpt-5.1",
    PROOFSPEND_AGENT_API_TOKEN: "test-agent-api-token-that-is-at-least-32-chars",
    PROOFSPEND_ADAPTER_MODE: "arc-testnet" as const,
    PROOFSPEND_AGENT_MODE: "openai" as const,
    CIRCLE_API_KEY: "TEST_API_KEY:test:key",
    CIRCLE_ENTITY_SECRET: "a".repeat(64),
    CIRCLE_SOURCE_WALLET_ID: "44444444-4444-4444-8444-444444444444",
    CIRCLE_DESTINATION_WALLET_ID: "55555555-5555-4555-8555-555555555555",
    CIRCLE_DESTINATION_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
    CIRCLE_CHAIN: "ARC-TESTNET" as const,
    CIRCLE_USDC_TOKEN_ADDRESS: "0x3600000000000000000000000000000000000000" as const,
    CIRCLE_POLL_INTERVAL_MS: 1,
    CIRCLE_MAX_POLLS: 3,
    CIRCLE_ARGSCAN_BASE_URL: "https://testnet.arcscan.app" as const,
    PROOFSPEND_AUTH_STORE_PATH: join(directory, "authorization.json"),
  };
  for (const [key, value] of Object.entries(environment)) {
    vi.stubEnv(key, String(value));
  }
  const initial = await runVerificationAgent({
    agentMode: "mock",
    now: "2026-08-09T00:00:00.000Z",
  });
  const scenario = createPawPovAiEvidenceScenario();
  const run = resumeVerificationAgentAfterFounderCorrection({
    run: initial,
    authenticatedActorId: scenario.authorizedFounder.actorId,
    receipt: scenario.recoveryReceipt,
    acceptedMatch: scenario.recoveryMatch,
    now: "2026-08-09T00:01:00.000Z",
  });
  return {
    environment,
    run,
    approval: {
      approvalId: "approval:live-test",
      intentId: run.proposal!.intentId,
      authorizedActorRole: "FOUNDER" as const,
      authorizedActorId: scenario.authorizedFounder.actorId,
      decision: "APPROVED" as const,
      decidedAt: "2026-08-09T00:01:01.000Z",
      expiresAt: run.proposal!.expiresAt,
      idempotencyKey: run.proposal!.idempotencyKey,
    },
    store: new FileTransferAuthorizationStore(environment.PROOFSPEND_AUTH_STORE_PATH),
  };
}
