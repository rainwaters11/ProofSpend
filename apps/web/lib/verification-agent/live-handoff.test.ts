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
import {
  buildLiveTransferAuthorization,
  executeLiveCircleHandoff,
  recoverPersistedLiveCircleHandoff,
} from "./live-handoff";

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
    await expect(
      context.store.loadResultHistory(context.run.proposal!.idempotencyKey),
    ).resolves.toMatchObject([
      { status: "PREPARED" },
      { status: "SUBMITTED" },
      { status: "CONFIRMED" },
    ]);
    await expect(
      context.store.loadReconciliations(context.run.proposal!.idempotencyKey),
    ).resolves.toMatchObject([
      {
        status: "RECONCILED",
        amountAtomic: "1000000",
        transactionHash: `0x${"1a".repeat(32)}`,
      },
    ]);
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

  it("recovers a persisted confirmation through the restart path without calling Circle", async () => {
    const context = await liveContext();
    const { intent, authorization } = await buildLiveTransferAuthorization({
      run: context.run,
      approval: context.approval,
      environment: context.environment,
    });
    const providerOperationId = "11111111-1111-4111-8111-111111111111";
    const transactionHash = `0x${"1a".repeat(32)}`;
    const blockHash = `0x${"2b".repeat(32)}`;
    const explorerUrl = `https://testnet.arcscan.app/tx/${transactionHash}`;

    await context.store.persist(authorization);
    await context.store.recordResult({
      proposalId: intent.proposalId,
      idempotencyKey: intent.idempotencyKey,
      mode: "ARC_TESTNET",
      status: "PREPARED",
      polledAt: "2026-08-09T00:01:02.000Z",
    });
    await context.store.consume({
      releaseRequestId: intent.releaseRequestId,
      approvalId: intent.approvalId,
      authorizationBindingId: intent.authorizationBindingId,
      transactionRecordId: intent.transactionRecordId,
      intentId: intent.intentId,
      expectedExactIntentHash: authorization.binding.exactIntentHash,
      idempotencyKey: intent.idempotencyKey,
      asOf: "2026-08-09T00:01:03.000Z",
    });
    await context.store.recordResult({
      proposalId: intent.proposalId,
      idempotencyKey: intent.idempotencyKey,
      mode: "ARC_TESTNET",
      status: "SUBMITTED",
      providerOperationId,
      polledAt: "2026-08-09T00:01:03.000Z",
    });
    await context.store.recordResult({
      proposalId: intent.proposalId,
      idempotencyKey: intent.idempotencyKey,
      mode: "ARC_TESTNET",
      status: "CONFIRMED",
      providerOperationId,
      transactionHash,
      blockNumber: 42,
      blockHash,
      explorerUrl,
      polledAt: "2026-08-09T00:01:04.000Z",
    });
    const providerFactory = vi.fn(() => fakeProvider([]));

    const recovered = await recoverPersistedLiveCircleHandoff({
      runId: context.run.runId,
      approval: context.approval,
      authenticatedActorId: context.approval.authorizedActorId,
      environment: context.environment,
      dependencies: { store: context.store, providerFactory },
    });

    expect(providerFactory).not.toHaveBeenCalled();
    expect(recovered).toMatchObject({
      status: "HANDOFF_CONFIRMED",
      execution: {
        state: "CONFIRMED",
        idempotencyKey: intent.idempotencyKey,
        reconciliation: {
          state: "RECONCILED",
          reconciliationId: `reconciliation:${intent.transactionRecordId}`,
          reconciledAt: expect.any(String),
        },
      },
    });
    expect(recovered?.execution.reconciliation?.reconciledAt).not.toBe(
      "2026-08-09T00:01:04.000Z",
    );
    await expect(context.store.loadReconciliations(intent.idempotencyKey)).resolves.toHaveLength(1);

    await expect(
      recoverPersistedLiveCircleHandoff({
        runId: context.run.runId,
        approval: context.approval,
        authenticatedActorId: context.approval.authorizedActorId,
        environment: context.environment,
        dependencies: { store: context.store, providerFactory },
      }),
    ).rejects.toThrow("HANDOFF_DUPLICATE");
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("recovers a consumed Circle submission with the same idempotency key", async () => {
    const context = await liveContext();
    const { intent, authorization } = await buildLiveTransferAuthorization({
      run: context.run,
      approval: context.approval,
      environment: context.environment,
    });
    await context.store.persist(authorization);
    await context.store.recordResult({
      proposalId: intent.proposalId,
      idempotencyKey: intent.idempotencyKey,
      mode: "ARC_TESTNET",
      status: "PREPARED",
    });
    await context.store.consume({
      releaseRequestId: intent.releaseRequestId,
      approvalId: intent.approvalId,
      authorizationBindingId: intent.authorizationBindingId,
      transactionRecordId: intent.transactionRecordId,
      intentId: intent.intentId,
      expectedExactIntentHash: authorization.binding.exactIntentHash,
      idempotencyKey: intent.idempotencyKey,
      asOf: "2026-08-09T00:01:02.000Z",
    });
    const prepareTransfer = vi.fn();
    const provider = fakeProvider([], { prepareTransfer });

    const result = await executeLiveCircleHandoff({
      run: context.run,
      approval: context.approval,
      environment: context.environment,
      initialActivityTrace: context.run.activityTrace,
      dependencies: { store: context.store, providerFactory: () => provider },
    });

    expect(prepareTransfer).not.toHaveBeenCalled();
    expect(result.status).toBe("HANDOFF_CONFIRMED");
    await expect(context.store.loadResult(intent.idempotencyKey)).resolves.toMatchObject({
      proposalId: intent.proposalId,
      idempotencyKey: intent.idempotencyKey,
      status: "CONFIRMED",
    });
  });

  it("rejects a source wallet change after the exact intent is presented", async () => {
    const context = await liveContext();
    await expect(
      executeLiveCircleHandoff({
        run: context.run,
        approval: context.approval,
        environment: {
          ...context.environment,
          CIRCLE_SOURCE_WALLET_ID: "66666666-6666-4666-8666-666666666666",
        },
        initialActivityTrace: context.run.activityTrace,
        dependencies: { store: context.store, providerFactory: () => fakeProvider([]) },
      }),
    ).rejects.toThrow("LIVE_HANDOFF_PROPOSAL_INVALID");
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

  it("retries the same approval and idempotency key after a pre-submission failure", async () => {
    const context = await liveContext();
    const first = await executeLiveCircleHandoff({
      run: context.run,
      approval: context.approval,
      environment: context.environment,
      initialActivityTrace: context.run.activityTrace,
      dependencies: {
        store: context.store,
        providerFactory: () =>
          fakeProvider([], {
            prepareTransfer: async () => {
              throw new Error("temporary provider outage");
            },
          }),
      },
    });
    expect(first).toMatchObject({
      status: "HANDOFF_FAILED",
      execution: { state: "FAILED", providerOperationId: null },
    });

    const recovered = await executeLiveCircleHandoff({
      run: context.run,
      approval: context.approval,
      environment: context.environment,
      initialActivityTrace: context.run.activityTrace,
      dependencies: { store: context.store, providerFactory: () => fakeProvider([]) },
    });

    expect(recovered).toMatchObject({
      status: "HANDOFF_CONFIRMED",
      execution: {
        state: "CONFIRMED",
        idempotencyKey: context.run.proposal!.idempotencyKey,
      },
    });
    const history = await context.store.loadResultHistory(
      context.run.proposal!.idempotencyKey,
    );
    expect(history).toMatchObject([
      { status: "FAILED" },
      { status: "PREPARED" },
      { status: "SUBMITTED" },
      { status: "CONFIRMED" },
    ]);
    expect(history[0]).not.toHaveProperty("providerOperationId");
  });

  it("atomically claims a pre-submission retry across independent requests", async () => {
    const context = await liveContext();
    await executeLiveCircleHandoff({
      run: context.run,
      approval: context.approval,
      environment: context.environment,
      initialActivityTrace: context.run.activityTrace,
      dependencies: {
        store: context.store,
        providerFactory: () =>
          fakeProvider([], {
            prepareTransfer: async () => {
              throw new Error("temporary provider outage");
            },
          }),
      },
    });

    let releasePreparation!: () => void;
    const preparationReleased = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    let preparationStarted!: () => void;
    const preparationDidStart = new Promise<void>((resolve) => {
      preparationStarted = resolve;
    });
    const authorizationConsumptions = vi.fn();
    const providerSubmissions = vi.fn();
    const providerFactory = vi.fn(
      ({ store }: { store: FileTransferAuthorizationStore }) => {
        const provider = fakeProvider([]);
        return fakeProvider([], {
          async prepareTransfer(intent) {
            preparationStarted();
            await preparationReleased;
            return provider.prepareTransfer(intent);
          },
          async submitTransfer(intent) {
            providerSubmissions();
            const authorization = await store.load(intent);
            if (authorization === null) throw new Error("authorization missing");
            const consumed = await store.consume({
              releaseRequestId: intent.releaseRequestId,
              approvalId: intent.approvalId,
              authorizationBindingId: intent.authorizationBindingId,
              transactionRecordId: intent.transactionRecordId,
              intentId: intent.intentId,
              expectedExactIntentHash: authorization.binding.exactIntentHash,
              idempotencyKey: intent.idempotencyKey,
              asOf: "2026-08-09T00:01:02.000Z",
            });
            if (consumed === null) throw new Error("authorization unavailable");
            authorizationConsumptions();
            return provider.submitTransfer(intent);
          },
        });
      },
    );
    const request = (store: FileTransferAuthorizationStore) =>
      executeLiveCircleHandoff({
        run: context.run,
        approval: context.approval,
        environment: context.environment,
        initialActivityTrace: context.run.activityTrace,
        dependencies: { store, providerFactory },
      });

    const winner = request(
      new FileTransferAuthorizationStore(context.environment.PROOFSPEND_AUTH_STORE_PATH),
    );
    await preparationDidStart;
    const loser = request(
      new FileTransferAuthorizationStore(context.environment.PROOFSPEND_AUTH_STORE_PATH),
    );
    await expect(loser).rejects.toThrow("HANDOFF_DUPLICATE");
    releasePreparation();
    await expect(winner).resolves.toMatchObject({ status: "HANDOFF_CONFIRMED" });

    expect(providerFactory).toHaveBeenCalledTimes(1);
    expect(authorizationConsumptions).toHaveBeenCalledTimes(1);
    expect(providerSubmissions).toHaveBeenCalledTimes(1);
    await expect(
      context.store.loadResultHistory(context.run.proposal!.idempotencyKey),
    ).resolves.toMatchObject([
      { status: "FAILED" },
      { status: "PREPARED" },
      { status: "SUBMITTED" },
      { status: "CONFIRMED" },
    ]);
  });

  it("rejects a retry after a failed submitted operation exists", async () => {
    const context = await liveContext();
    const operationId = "11111111-1111-4111-8111-111111111111";
    const failingProvider = fakeProvider([], {
      pollTransfer: async () => ({
        mode: "ARC_TESTNET",
        status: "FAILED",
        providerOperationId: operationId,
        failureCode: "POLLING_TIMEOUT",
        failureMessage: "The submitted operation failed.",
      }),
    });

    const failed = await executeLiveCircleHandoff({
      run: context.run,
      approval: context.approval,
      environment: context.environment,
      initialActivityTrace: context.run.activityTrace,
      dependencies: { store: context.store, providerFactory: () => failingProvider },
    });
    expect(failed).toMatchObject({
      status: "HANDOFF_FAILED",
      execution: { state: "FAILED", providerOperationId: operationId },
    });

    const providerFactory = vi.fn(() => fakeProvider([]));
    await expect(
      executeLiveCircleHandoff({
        run: context.run,
        approval: context.approval,
        environment: context.environment,
        initialActivityTrace: context.run.activityTrace,
        dependencies: { store: context.store, providerFactory },
      }),
    ).rejects.toThrow("HANDOFF_DUPLICATE");
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it("retains a recoverable Circle operation when polling is interrupted", async () => {
    const context = await liveContext();
    const provider = fakeProvider([], {
      async submitTransfer(intent) {
        const authorization = await context.store.load(intent);
        if (authorization === null) throw new Error("authorization missing");
        await context.store.consume({
          releaseRequestId: intent.releaseRequestId,
          approvalId: intent.approvalId,
          authorizationBindingId: intent.authorizationBindingId,
          transactionRecordId: intent.transactionRecordId,
          intentId: intent.intentId,
          expectedExactIntentHash: authorization.binding.exactIntentHash,
          idempotencyKey: intent.idempotencyKey,
          asOf: "2026-08-09T00:01:02.000Z",
        });
        return {
          mode: "ARC_TESTNET",
          status: "SUBMITTED",
          providerOperationId: "11111111-1111-4111-8111-111111111111",
        };
      },
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
      status: "HANDOFF_SUBMITTED",
      execution: {
        state: "SUBMITTED",
        providerOperationId: "11111111-1111-4111-8111-111111111111",
        transactionHash: null,
      },
    });
  });

  it("recovers when Circle may accept a request before its response is recorded", async () => {
    const context = await liveContext();
    const firstProvider = fakeProvider([], {
      async submitTransfer(intent) {
        const authorization = await context.store.load(intent);
        if (authorization === null) throw new Error("authorization missing");
        await context.store.consume({
          releaseRequestId: intent.releaseRequestId,
          approvalId: intent.approvalId,
          authorizationBindingId: intent.authorizationBindingId,
          transactionRecordId: intent.transactionRecordId,
          intentId: intent.intentId,
          expectedExactIntentHash: authorization.binding.exactIntentHash,
          idempotencyKey: intent.idempotencyKey,
          asOf: "2026-08-09T00:01:02.000Z",
        });
        throw new Error("Circle response lost");
      },
    });

    const uncertain = await executeLiveCircleHandoff({
      run: context.run,
      approval: context.approval,
      environment: context.environment,
      initialActivityTrace: context.run.activityTrace,
      dependencies: { store: context.store, providerFactory: () => firstProvider },
    });
    expect(uncertain).toMatchObject({
      status: "HANDOFF_SUBMITTED",
      execution: { state: "SUBMITTED", providerOperationId: null },
    });

    const recovered = await executeLiveCircleHandoff({
      run: context.run,
      approval: context.approval,
      environment: context.environment,
      initialActivityTrace: context.run.activityTrace,
      dependencies: { store: context.store, providerFactory: () => fakeProvider([]) },
    });
    expect(recovered.status).toBe("HANDOFF_CONFIRMED");
  });
});

function fakeProvider(
  seen: ApprovedTransferIntent[],
  overrides: Partial<ArcTestnetTransferProvider> = {},
): ArcTestnetTransferProvider {
  const operationId = "11111111-1111-4111-8111-111111111111";
  const transactionHash = `0x${"1a".repeat(32)}`;
  const result = (_intent: ApprovedTransferIntent, status: TransferResult["status"]): TransferResult => ({
    mode: "ARC_TESTNET",
    status,
    providerOperationId: status === "PREPARED" ? undefined : operationId,
    transactionHash: status === "CONFIRMED" ? transactionHash : undefined,
    blockNumber: status === "CONFIRMED" ? 42 : undefined,
    blockHash: status === "CONFIRMED" ? `0x${"2b".repeat(32)}` : undefined,
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
  const run = await resumeVerificationAgentAfterFounderCorrection({
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
      exactIntentHash: run.proposal!.exactIntentHash,
    },
    store: new FileTransferAuthorizationStore(environment.PROOFSPEND_AUTH_STORE_PATH),
  };
}
