import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("keeps the lock path occupied while two contenders validate a renewed lease", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofspend-renewed-lock-"));
    directories.push(directory);
    const path = join(directory, "authorization.json");
    const lockPath = `${path}.lock`;
    const ownerToken = "11111111-1111-4111-8111-111111111111";
    await writeFile(
      lockPath,
      JSON.stringify({
        ownerToken,
        pid: process.pid,
        createdAt: "2026-08-09T00:00:00.000Z",
      }),
      { mode: 0o600 },
    );
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleAt, staleAt);

    type StoreInternals = {
      quarantinedLockStillStale: (
        snapshot: unknown,
        quarantinePath: string,
      ) => Promise<boolean>;
      reclaimStaleLock: () => Promise<boolean>;
    };
    const firstStore = new FileTransferAuthorizationStore(path);
    const secondStore = new FileTransferAuthorizationStore(path);
    const first = firstStore as unknown as StoreInternals;
    const second = secondStore as unknown as StoreInternals;
    const validateQuarantine = first.quarantinedLockStillStale.bind(firstStore);
    let signalQuarantineReady!: () => void;
    let releaseValidation!: () => void;
    const quarantineReady = new Promise<void>((resolve) => {
      signalQuarantineReady = resolve;
    });
    const validationRelease = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    first.quarantinedLockStillStale = async (snapshot, quarantinePath) => {
      signalQuarantineReady();
      await validationRelease;
      return validateQuarantine(snapshot, quarantinePath);
    };

    const firstReclaim = first.reclaimStaleLock();
    await quarantineReady;
    await expect(
      writeFile(lockPath, "second-owner", { flag: "wx" }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    await expect(second.reclaimStaleLock()).resolves.toBe(false);

    const renewedAt = new Date();
    await utimes(lockPath, renewedAt, renewedAt);
    releaseValidation();

    await expect(firstReclaim).resolves.toBe(false);
    await expect(readFile(lockPath, "utf8")).resolves.toContain(ownerToken);
    await expect(readFile(`${lockPath}.reclaim`, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fences owner release and normal acquisition while reclamation validates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofspend-fenced-reclaim-"));
    directories.push(directory);
    const path = join(directory, "authorization.json");
    const lockPath = `${path}.lock`;
    const ownerToken = "11111111-1111-4111-8111-111111111111";
    await writeFile(
      lockPath,
      JSON.stringify({
        ownerToken,
        pid: process.pid,
        createdAt: "2026-08-09T00:00:00.000Z",
      }),
      { mode: 0o600 },
    );
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleAt, staleAt);

    type StoreInternals = {
      quarantinedLockStillStale: (
        snapshot: unknown,
        quarantinePath: string,
      ) => Promise<boolean>;
      reclaimStaleLock: () => Promise<boolean>;
      releaseOwnedLock: (token: string) => Promise<void>;
      withLock: <T>(operation: () => Promise<T>) => Promise<T>;
    };
    const reclaimerStore = new FileTransferAuthorizationStore(path);
    const ownerStore = new FileTransferAuthorizationStore(path);
    const contenderStore = new FileTransferAuthorizationStore(path);
    const reclaimer = reclaimerStore as unknown as StoreInternals;
    const owner = ownerStore as unknown as StoreInternals;
    const contender = contenderStore as unknown as StoreInternals;
    const validateQuarantine =
      reclaimer.quarantinedLockStillStale.bind(reclaimerStore);
    let signalQuarantineReady!: () => void;
    let releaseValidation!: () => void;
    const quarantineReady = new Promise<void>((resolve) => {
      signalQuarantineReady = resolve;
    });
    const validationRelease = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    reclaimer.quarantinedLockStillStale = async (snapshot, quarantinePath) => {
      signalQuarantineReady();
      await validationRelease;
      return validateQuarantine(snapshot, quarantinePath);
    };

    const reclaim = reclaimer.reclaimStaleLock();
    await quarantineReady;

    let ownerReleaseCompleted = false;
    const ownerRelease = owner.releaseOwnedLock(ownerToken).then(() => {
      ownerReleaseCompleted = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(ownerReleaseCompleted).toBe(false);
    await expect(readFile(lockPath, "utf8")).resolves.toContain(ownerToken);

    let contenderEntered = false;
    const contenderRun = contender.withLock(async () => {
      contenderEntered = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(contenderEntered).toBe(false);
    await expect(readFile(lockPath, "utf8")).resolves.toContain(ownerToken);

    releaseValidation();
    await expect(reclaim).resolves.toBe(true);
    await expect(ownerRelease).resolves.toBeUndefined();
    expect(ownerReleaseCompleted).toBe(true);
    await expect(contenderRun).resolves.toBeUndefined();
    expect(contenderEntered).toBe(true);
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("retries owner release while the namespace guard is briefly busy", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "proofspend-release-guard-contention-"),
    );
    directories.push(directory);
    const path = join(directory, "authorization.json");
    const lockPath = `${path}.lock`;
    const ownerToken = "11111111-1111-4111-8111-111111111111";
    const guardOwnerToken = "22222222-2222-4222-8222-222222222222";
    await writeFile(
      lockPath,
      JSON.stringify({
        ownerToken,
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );

    type StoreInternals = {
      acquireReclaimGuard: (
        token: string,
      ) => Promise<Awaited<ReturnType<typeof import("node:fs/promises").open>> | null>;
      releaseReclaimGuard: (token: string) => Promise<void>;
      releaseOwnedLock: (token: string) => Promise<void>;
      withLock: <T>(operation: () => Promise<T>) => Promise<T>;
    };
    const guardStore = new FileTransferAuthorizationStore(path);
    const ownerStore = new FileTransferAuthorizationStore(path);
    const contenderStore = new FileTransferAuthorizationStore(path);
    const guardInternal = guardStore as unknown as StoreInternals;
    const owner = ownerStore as unknown as StoreInternals;
    const contender = contenderStore as unknown as StoreInternals;
    const heldGuard =
      await guardInternal.acquireReclaimGuard(guardOwnerToken);
    expect(heldGuard).not.toBeNull();

    let releaseCompleted = false;
    const release = owner.releaseOwnedLock(ownerToken).then(() => {
      releaseCompleted = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(releaseCompleted).toBe(false);
    await expect(readFile(lockPath, "utf8")).resolves.toContain(ownerToken);

    await heldGuard!.close();
    await guardInternal.releaseReclaimGuard(guardOwnerToken);
    await expect(release).resolves.toBeUndefined();
    expect(releaseCompleted).toBe(true);
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });

    let contenderEntered = false;
    await expect(
      contender.withLock(async () => {
        contenderEntered = true;
      }),
    ).resolves.toBeUndefined();
    expect(contenderEntered).toBe(true);
  });

  it("renews and preserves the reclaim guard during long validation", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date());
      const directory = await mkdtemp(
        join(tmpdir(), "proofspend-reclaim-heartbeat-"),
      );
      directories.push(directory);
      const path = join(directory, "authorization.json");
      const lockPath = `${path}.lock`;
      const reclaimPath = `${lockPath}.reclaim`;
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

      type StoreInternals = {
        acquireReclaimGuard: (
          token: string,
        ) => Promise<Awaited<ReturnType<typeof import("node:fs/promises").open>> | null>;
        quarantinedLockStillStale: (
          snapshot: unknown,
          quarantinePath: string,
        ) => Promise<boolean>;
        reclaimStaleLock: () => Promise<boolean>;
      };
      const firstStore = new FileTransferAuthorizationStore(path);
      const secondStore = new FileTransferAuthorizationStore(path);
      const first = firstStore as unknown as StoreInternals;
      const second = secondStore as unknown as StoreInternals;
      const validateQuarantine =
        first.quarantinedLockStillStale.bind(firstStore);
      let signalQuarantineReady!: () => void;
      let releaseValidation!: () => void;
      const quarantineReady = new Promise<void>((resolve) => {
        signalQuarantineReady = resolve;
      });
      const validationRelease = new Promise<void>((resolve) => {
        releaseValidation = resolve;
      });
      first.quarantinedLockStillStale = async (snapshot, quarantinePath) => {
        signalQuarantineReady();
        await validationRelease;
        return validateQuarantine(snapshot, quarantinePath);
      };

      const reclaim = first.reclaimStaleLock();
      await quarantineReady;
      const initialGuard = await readFile(reclaimPath, "utf8");
      const initialMtime = (await stat(reclaimPath)).mtimeMs;

      await vi.advanceTimersByTimeAsync(10_000);

      expect((await stat(reclaimPath)).mtimeMs).toBeGreaterThan(initialMtime);
      await expect(
        second.acquireReclaimGuard(
          "22222222-2222-4222-8222-222222222222",
        ),
      ).resolves.toBeNull();
      await expect(readFile(reclaimPath, "utf8")).resolves.toBe(initialGuard);

      releaseValidation();
      await expect(reclaim).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not remove a reclaim guard whose owner token changed", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "proofspend-reclaim-owner-token-"),
    );
    directories.push(directory);
    const path = join(directory, "authorization.json");
    const reclaimPath = `${path}.lock.reclaim`;
    const originalOwner = "11111111-1111-4111-8111-111111111111";
    const replacementOwner = "22222222-2222-4222-8222-222222222222";
    await writeFile(
      reclaimPath,
      JSON.stringify({
        ownerToken: originalOwner,
        pid: process.pid,
        createdAt: "2026-08-09T00:00:00.000Z",
      }),
      { mode: 0o600 },
    );
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(reclaimPath, staleAt, staleAt);

    type GuardSnapshot = {
      device: number;
      inode: number;
      mtimeMs: number;
      raw: string;
      ownerToken: string | null;
    };
    type StoreInternals = {
      acquireReclaimGuard: (
        token: string,
      ) => Promise<Awaited<ReturnType<typeof import("node:fs/promises").open>> | null>;
      staleReclaimGuardIsUnchanged: (
        snapshot: GuardSnapshot,
      ) => Promise<boolean>;
    };
    const store = new FileTransferAuthorizationStore(path);
    const internal = store as unknown as StoreInternals;
    const validateGuard =
      internal.staleReclaimGuardIsUnchanged.bind(store);
    internal.staleReclaimGuardIsUnchanged = async (snapshot) => {
      await writeFile(
        reclaimPath,
        JSON.stringify({
          ownerToken: replacementOwner,
          pid: process.pid,
          createdAt: new Date().toISOString(),
        }),
        { mode: 0o600 },
      );
      return validateGuard(snapshot);
    };

    await expect(
      internal.acquireReclaimGuard(
        "33333333-3333-4333-8333-333333333333",
      ),
    ).resolves.toBeNull();
    await expect(readFile(reclaimPath, "utf8")).resolves.toContain(
      replacementOwner,
    );
  });

  it("does not reclaim an expired lease from the still-running process instance", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "proofspend-live-process-lease-"),
    );
    directories.push(directory);
    const path = join(directory, "authorization.json");
    const lockPath = `${path}.lock`;

    type StoreInternals = {
      reclaimStaleLock: () => Promise<boolean>;
      withLock: <T>(operation: (ownerToken: string) => Promise<T>) => Promise<T>;
    };
    const ownerStore = new FileTransferAuthorizationStore(path);
    const contenderStore = new FileTransferAuthorizationStore(path);
    const owner = ownerStore as unknown as StoreInternals;
    const contender = contenderStore as unknown as StoreInternals;
    let signalOwnerEntered!: () => void;
    let releaseOwner!: () => void;
    const ownerEntered = new Promise<void>((resolve) => {
      signalOwnerEntered = resolve;
    });
    const ownerRelease = new Promise<void>((resolve) => {
      releaseOwner = resolve;
    });

    const ownerRun = owner.withLock(async () => {
      signalOwnerEntered();
      await ownerRelease;
    });
    await ownerEntered;

    const metadata = JSON.parse(await readFile(lockPath, "utf8"));
    expect(metadata.processIdentity).toEqual(expect.any(String));
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleAt, staleAt);

    await expect(contender.reclaimStaleLock()).resolves.toBe(false);
    await expect(readFile(lockPath, "utf8")).resolves.toContain(
      metadata.ownerToken,
    );

    releaseOwner();
    await expect(ownerRun).resolves.toBeUndefined();
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects a durable write after its owner token was replaced", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "proofspend-fenced-state-write-"),
    );
    directories.push(directory);
    const path = join(directory, "authorization.json");
    const lockPath = `${path}.lock`;
    const newerState = {
      version: 2 as const,
      authorizations: {},
      resultHistory: {
        "newer-owner-result": [
          {
            idempotencyKey: "newer-owner-result",
            mode: "MOCK" as const,
            status: "PREPARED" as const,
          },
        ],
      },
      latestResultKey: "newer-owner-result",
      handoffHistory: [],
      reconciliations: [],
    };
    const staleState = {
      version: 2 as const,
      authorizations: {},
      resultHistory: {},
      latestResultKey: null,
      handoffHistory: [],
      reconciliations: [],
    };
    await writeFile(path, JSON.stringify(newerState), { mode: 0o600 });

    type StoreInternals = {
      withLock: <T>(operation: (ownerToken: string) => Promise<T>) => Promise<T>;
      writeState: (state: unknown, ownerToken: string) => Promise<void>;
    };
    const store = new FileTransferAuthorizationStore(path);
    const internal = store as unknown as StoreInternals;
    await expect(
      internal.withLock(async (ownerToken) => {
        await writeFile(
          lockPath,
          JSON.stringify({
            ownerToken: "22222222-2222-4222-8222-222222222222",
            pid: process.pid,
            processIdentity: "replacement-process",
            createdAt: new Date().toISOString(),
          }),
          { mode: 0o600 },
        );
        await internal.writeState(staleState, ownerToken);
      }),
    ).rejects.toThrow("AUTHORIZATION_STORE_LOCK_LOST");

    const persisted = JSON.parse(await readFile(path, "utf8"));
    expect(persisted.latestResultKey).toBe("newer-owner-result");
    expect(persisted.resultHistory["newer-owner-result"]).toHaveLength(1);
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
        processIdentity: "linux:previous-boot:previous-start",
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

  it("atomically reclaims an abandoned retry claim and fences the stale claimant", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-09T00:02:00.000Z"));
      const directory = await mkdtemp(join(tmpdir(), "proofspend-retry-lease-"));
      directories.push(directory);
      const path = join(directory, "authorization.json");
      const environment = liveEnvironment(path);
      const run = await approvalRun(environment);
      const { intent, authorization } = await buildLiveTransferAuthorization({
        run,
        approval: approvalFor(run),
        environment,
      });
      const abandonedProcess = new FileTransferAuthorizationStore(path);
      const restartedProcess = new FileTransferAuthorizationStore(path);
      await abandonedProcess.persist(authorization);
      const failed = {
        proposalId: intent.proposalId,
        idempotencyKey: intent.idempotencyKey,
        mode: "ARC_TESTNET" as const,
        status: "FAILED" as const,
        failureCode: "AUTHORIZATION_UNAVAILABLE" as const,
        failureMessage: "Preparation failed before submission.",
      };
      await abandonedProcess.recordResult(failed);
      const staleToken = await abandonedProcess.claimPreSubmissionRetry(intent);
      expect(staleToken).toEqual(expect.any(String));

      await vi.advanceTimersByTimeAsync(30_001);
      const replacementToken =
        await restartedProcess.claimPreSubmissionRetry(intent);
      expect(replacementToken).toEqual(expect.any(String));
      expect(replacementToken).not.toBe(staleToken);

      const prepared = {
        proposalId: intent.proposalId,
        idempotencyKey: intent.idempotencyKey,
        mode: "ARC_TESTNET" as const,
        status: "PREPARED" as const,
      };
      await expect(
        abandonedProcess.completePreSubmissionRetryClaim(staleToken!, prepared),
      ).rejects.toThrow("PRE_SUBMISSION_RETRY_CLAIM_LOST");
      await expect(
        restartedProcess.completePreSubmissionRetryClaim(replacementToken!, prepared),
      ).resolves.toBeUndefined();
      await restartedProcess.recordResult({
        ...prepared,
        status: "SUBMITTED",
        providerOperationId: "11111111-1111-4111-8111-111111111111",
      });
      await restartedProcess.recordResult({
        ...prepared,
        status: "CONFIRMED",
        providerOperationId: "11111111-1111-4111-8111-111111111111",
      });

      await expect(
        restartedProcess.loadResultHistory(intent.idempotencyKey),
      ).resolves.toMatchObject([
        { status: "FAILED" },
        { status: "PREPARED" },
        { status: "SUBMITTED" },
        { status: "CONFIRMED" },
      ]);
    } finally {
      vi.useRealTimers();
    }
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
