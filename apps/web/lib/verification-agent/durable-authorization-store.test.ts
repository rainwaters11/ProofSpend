import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPawPovAiEvidenceScenario } from "@proofspend/domain";
import { buildLiveTransferAuthorization } from "./live-handoff";
import {
  resumeVerificationAgentAfterFounderCorrection,
  runVerificationAgent,
} from "./orchestrator";
import { FileTransferAuthorizationStore } from "./durable-authorization-store";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("FileTransferAuthorizationStore", () => {
  it("atomically consumes an approval once and preserves the consumed state across instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofspend-authorization-"));
    directories.push(directory);
    const path = join(directory, "authorization.json");
    const environment = liveEnvironment(path);
    const run = await approvalRun(environment);
    const approval = approvalFor(run);
    const { intent, authorization } = await buildLiveTransferAuthorization({
      run,
      approval,
      environment,
    });
    const firstProcess = new FileTransferAuthorizationStore(path);

    await expect(firstProcess.persist(authorization)).resolves.toBe(true);
    await expect(firstProcess.persist(authorization)).resolves.toBe(false);

    const consumeInput = {
      releaseRequestId: intent.releaseRequestId,
      approvalId: intent.approvalId,
      authorizationBindingId: intent.authorizationBindingId,
      transactionRecordId: intent.transactionRecordId,
      intentId: intent.intentId,
      expectedExactIntentHash: authorization.binding.exactIntentHash,
      idempotencyKey: intent.idempotencyKey,
      asOf: "2026-08-09T00:01:02.000Z",
    };
    const consumed = await firstProcess.consume(consumeInput);
    expect(consumed?.binding.status).toBe("ACTIVE");

    const restartedProcess = new FileTransferAuthorizationStore(path);
    await expect(restartedProcess.consume(consumeInput)).resolves.toBeNull();
    expect((await restartedProcess.load(intent))?.binding.status).toBe("CONSUMED");
    expect(await readFile(path, "utf8")).not.toContain(environment.CIRCLE_API_KEY);
    expect(await readFile(path, "utf8")).not.toContain(environment.CIRCLE_ENTITY_SECRET);
  });
  it("reclaims a confirmed-stale legacy lock after a process crash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofspend-stale-lock-"));
    directories.push(directory);
    const path = join(directory, "authorization.json");
    const lockPath = `${path}.lock`;
    const environment = liveEnvironment(path);
    const run = await approvalRun(environment);
    const { authorization } = await buildLiveTransferAuthorization({
      run,
      approval: approvalFor(run),
      environment,
    });
    await writeFile(lockPath, "", { mode: 0o600 });
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleAt, staleAt);

    const restartedProcess = new FileTransferAuthorizationStore(path);
    await expect(restartedProcess.persist(authorization)).resolves.toBe(true);
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reclaims an expired lease even when a restarted process reuses the owner PID", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofspend-reused-pid-lock-"));
    directories.push(directory);
    const path = join(directory, "authorization.json");
    const lockPath = `${path}.lock`;
    const environment = liveEnvironment(path);
    const run = await approvalRun(environment);
    const { authorization } = await buildLiveTransferAuthorization({
      run,
      approval: approvalFor(run),
      environment,
    });
    await writeFile(
      lockPath,
      JSON.stringify({
        ownerToken: "11111111-1111-4111-8111-111111111111",
        pid: process.pid,
        createdAt: "2026-08-09T00:00:00.000Z",
      }),
      { mode: 0o600 },
    );
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleAt, staleAt);

    const restartedProcess = new FileTransferAuthorizationStore(path);
    await expect(restartedProcess.persist(authorization)).resolves.toBe(true);
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("appends prepared, submitted, confirmed, and reconciliation evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofspend-lifecycle-"));
    directories.push(directory);
    const path = join(directory, "authorization.json");
    const environment = liveEnvironment(path);
    const run = await approvalRun(environment);
    const approval = approvalFor(run);
    const { intent, authorization } = await buildLiveTransferAuthorization({
      run,
      approval,
      environment,
    });
    const store = new FileTransferAuthorizationStore(path);
    const providerOperationId = "11111111-1111-4111-8111-111111111111";
    const transactionHash = `0x${"1a".repeat(32)}`;
    const blockHash = `0x${"2b".repeat(32)}`;
    const explorerUrl = `https://testnet.arcscan.app/tx/${transactionHash}`;

    await store.persist(authorization);
    await store.recordResult({
      proposalId: intent.proposalId,
      idempotencyKey: intent.idempotencyKey,
      mode: "ARC_TESTNET",
      status: "PREPARED",
      polledAt: "2026-08-09T00:01:02.000Z",
    });
    await store.recordResult({
      proposalId: intent.proposalId,
      idempotencyKey: intent.idempotencyKey,
      mode: "ARC_TESTNET",
      status: "SUBMITTED",
      providerOperationId,
      polledAt: "2026-08-09T00:01:03.000Z",
    });
    await store.recordResult({
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

    await expect(store.loadResultHistory(intent.idempotencyKey)).resolves.toMatchObject([
      { status: "PREPARED" },
      { status: "SUBMITTED" },
      { status: "CONFIRMED" },
    ]);
    await store.recordReconciliation({
      reconciliationId: `reconciliation:${intent.transactionRecordId}`,
      proposalId: intent.proposalId,
      idempotencyKey: intent.idempotencyKey,
      transactionRecordId: intent.transactionRecordId,
      mode: "ARC_TESTNET",
      status: "RECONCILED",
      network: intent.network,
      chainId: intent.chainId,
      asset: intent.asset,
      amountAtomic: intent.amountAtomic,
      providerOperationId,
      transactionHash,
      blockNumber: 42,
      blockHash,
      explorerUrl,
      reconciledAt: "2026-08-09T00:01:04.000Z",
    });
    await expect(store.loadReconciliations(intent.idempotencyKey)).resolves.toMatchObject([
      {
        status: "RECONCILED",
        amountAtomic: "1000000",
        transactionHash,
      },
    ]);

    const state = JSON.parse(await readFile(path, "utf8"));
    expect(state.version).toBe(2);
    expect(state.resultHistory[intent.idempotencyKey]).toHaveLength(3);
    expect(state.reconciliations).toHaveLength(1);
  });

});

function liveEnvironment(path: string) {
  return {
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
    PROOFSPEND_AUTH_STORE_PATH: path,
  };
}

async function approvalRun(environment: ReturnType<typeof liveEnvironment>) {
  const entries = Object.entries(environment).map(([key, value]) => [
    key,
    process.env[key],
    String(value),
  ] as const);
  for (const [key, , value] of entries) process.env[key] = value;
  try {
    const initial = await runVerificationAgent({
      agentMode: "mock",
      now: "2026-08-09T00:00:00.000Z",
    });
    const scenario = createPawPovAiEvidenceScenario();
    return await resumeVerificationAgentAfterFounderCorrection({
      run: initial,
      authenticatedActorId: scenario.authorizedFounder.actorId,
      receipt: scenario.recoveryReceipt,
      acceptedMatch: scenario.recoveryMatch,
      now: "2026-08-09T00:01:00.000Z",
    });
  } finally {
    for (const [key, previous] of entries) restore(key, previous);
  }
}

function approvalFor(run: Awaited<ReturnType<typeof approvalRun>>) {
  return {
    approvalId: "approval:durable-test",
    intentId: run.proposal!.intentId,
    authorizedActorRole: "FOUNDER" as const,
    authorizedActorId: "founder:fictional",
    decision: "APPROVED" as const,
    decidedAt: "2026-08-09T00:01:01.000Z",
    expiresAt: run.proposal!.expiresAt,
    idempotencyKey: run.proposal!.idempotencyKey,
    exactIntentHash: run.proposal!.exactIntentHash,
  };
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
