import "server-only";

import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, stat, unlink, utimes } from "node:fs/promises";
import { dirname } from "node:path";

import {
  ApprovalRecordSchema,
  ExecutionAuthorizationBindingSchema,
  ReleaseRequestSchema,
  TransactionRecordSchema,
} from "@proofspend/domain";
import type {
  PersistedTransferAuthorization,
  TransferAuthorizationReferences,
  TransferAuthorizationStore,
  ConsumeTransferAuthorizationInput,
  TransferResult,
} from "@proofspend/circle-adapter";
import { z } from "zod";

import { HandoffResultSchema, type HandoffResult } from "./schemas";

const DurableAuthorizationSchema = z
  .object({
    approval: ApprovalRecordSchema,
    release: ReleaseRequestSchema,
    transaction: TransactionRecordSchema,
    binding: ExecutionAuthorizationBindingSchema,
  })
  .strict();

const TransferResultSchema = z
  .object({
    proposalId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1).optional(),
    mode: z.enum(["ARC_TESTNET", "MOCK"]),
    status: z.enum(["PREPARED", "SUBMITTED", "CONFIRMED", "FAILED"]),
    failureCode: z
      .enum([
        "APPROVAL_MISSING",
        "APPROVAL_EXPIRED",
        "APPROVAL_ALTERED",
        "AUTHORIZATION_UNAVAILABLE",
        "AMOUNT_MISMATCH",
        "NETWORK_MISMATCH",
        "TOKEN_MISMATCH",
        "WALLET_MISMATCH",
        "INSUFFICIENT_BALANCE",
        "DUPLICATE_SUBMISSION",
        "POLLING_TIMEOUT",
        "CONFIRMATION_INCOMPLETE",
      ])
      .optional(),
    failureMessage: z.string().min(1).optional(),
    providerOperationId: z.string().min(1).optional(),
    transactionHash: z.string().min(1).optional(),
    blockNumber: z.number().int().positive().optional(),
    blockHash: z.string().min(1).optional(),
    explorerUrl: z.string().url().optional(),
    polledAt: z.string().datetime().optional(),
  })
  .strict();

export const DurableReconciliationRecordSchema = z
  .object({
    reconciliationId: z.string().min(1),
    proposalId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    transactionRecordId: z.string().min(1),
    mode: z.literal("ARC_TESTNET"),
    status: z.literal("RECONCILED"),
    network: z.literal("ARC-TESTNET"),
    chainId: z.literal("5042002"),
    asset: z.literal("USDC"),
    amountAtomic: z.string().regex(/^[0-9]+$/),
    providerOperationId: z.string().min(1),
    transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    blockNumber: z.number().int().positive(),
    blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    explorerUrl: z.string().url(),
    reconciledAt: z.string().datetime(),
  })
  .strict();

export type DurableReconciliationRecord = z.infer<
  typeof DurableReconciliationRecordSchema
>;

const LockMetadataSchema = z
  .object({
    ownerToken: z.string().uuid(),
    pid: z.number().int().positive(),
    createdAt: z.string().datetime(),
  })
  .strict();

type LockMetadata = z.infer<typeof LockMetadataSchema>;

type StaleLockSnapshot = {
  device: number;
  inode: number;
  mtimeMs: number;
  raw: string;
};

const LegacyDurableStateSchema = z
  .object({
    version: z.literal(1),
    authorizations: z.record(z.string(), DurableAuthorizationSchema),
    results: z.record(z.string(), TransferResultSchema),
    latestResultKey: z.string().nullable(),
    latestHandoff: HandoffResultSchema.nullable(),
  })
  .strict();

const DurableStateSchema = z
  .object({
    version: z.literal(2),
    authorizations: z.record(z.string(), DurableAuthorizationSchema),
    resultHistory: z.record(z.string(), z.array(TransferResultSchema).min(1)),
    latestResultKey: z.string().nullable(),
    handoffHistory: z.array(HandoffResultSchema),
    reconciliations: z.array(DurableReconciliationRecordSchema),
  })
  .strict();

type DurableState = z.infer<typeof DurableStateSchema>;

const EMPTY_STATE: DurableState = {
  version: 2,
  authorizations: {},
  resultHistory: {},
  latestResultKey: null,
  handoffHistory: [],
  reconciliations: [],
};

const LOCK_RETRIES = 100;
const LOCK_RETRY_MS = 10;
const LOCK_STALE_MS = 30_000;
const LOCK_HEARTBEAT_MS = 10_000;

function referencesMatch(
  snapshot: PersistedTransferAuthorization,
  references: TransferAuthorizationReferences,
): boolean {
  return (
    snapshot.release.id === references.releaseRequestId &&
    snapshot.approval.id === references.approvalId &&
    snapshot.binding.id === references.authorizationBindingId &&
    snapshot.transaction.id === references.transactionRecordId &&
    snapshot.binding.intentId === references.intentId
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canAppendResult(history: TransferResult[], next: TransferResult): boolean {
  const previous = history.at(-1);
  if (previous === undefined || sameValue(previous, next)) {
    return previous === undefined;
  }
  if (previous.status === "CONFIRMED" || previous.status === "FAILED") {
    throw new Error("TRANSFER_RESULT_TERMINAL");
  }
  const allowed =
    previous.status === "PREPARED"
      ? ["SUBMITTED", "FAILED"]
      : ["SUBMITTED", "CONFIRMED", "FAILED"];
  if (!allowed.includes(next.status)) {
    throw new Error("TRANSFER_RESULT_TRANSITION_INVALID");
  }
  return true;
}

function migrateState(value: unknown): DurableState {
  const current = DurableStateSchema.safeParse(value);
  if (current.success) {
    return current.data;
  }
  const legacy = LegacyDurableStateSchema.safeParse(value);
  if (!legacy.success) {
    return DurableStateSchema.parse(value);
  }
  return DurableStateSchema.parse({
    version: 2,
    authorizations: legacy.data.authorizations,
    resultHistory: Object.fromEntries(
      Object.entries(legacy.data.results).map(([key, result]) => [key, [result]]),
    ),
    latestResultKey: legacy.data.latestResultKey,
    handoffHistory:
      legacy.data.latestHandoff === null ? [] : [legacy.data.latestHandoff],
    reconciliations: [],
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseLockMetadata(raw: string): LockMetadata | null {
  try {
    const parsed = LockMetadataSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class FileTransferAuthorizationStore implements TransferAuthorizationStore {
  readonly path: string;
  private readonly lockPath: string;
  private readonly reclaimPath: string;

  constructor(path: string) {
    if (!path.trim()) {
      throw new Error("AUTHORIZATION_STORE_PATH_REQUIRED");
    }
    this.path = path;
    this.lockPath = `${path}.lock`;
    this.reclaimPath = `${path}.lock.reclaim`;
  }

  async persist(snapshot: PersistedTransferAuthorization): Promise<boolean> {
    const parsed = DurableAuthorizationSchema.parse(structuredClone(snapshot));
    return this.withLock(async () => {
      const state = await this.readState();
      const existing = Object.values(state.authorizations).find(
        (candidate) =>
          candidate.transaction.idempotencyKey === parsed.transaction.idempotencyKey ||
          candidate.binding.id === parsed.binding.id,
      );
      if (existing !== undefined) {
        return false;
      }
      state.authorizations[parsed.binding.id] = parsed;
      await this.writeState(state);
      return true;
    });
  }

  async load(
    references: TransferAuthorizationReferences,
  ): Promise<PersistedTransferAuthorization | null> {
    const state = await this.readState();
    const snapshot = state.authorizations[references.authorizationBindingId];
    if (snapshot === undefined || !referencesMatch(snapshot, references)) {
      return null;
    }
    return DurableAuthorizationSchema.parse(structuredClone(snapshot));
  }

  async loadAuthorizationByTransactionRecordId(
    transactionRecordId: string,
  ): Promise<PersistedTransferAuthorization | null> {
    const state = await this.readState();
    const snapshot = Object.values(state.authorizations).find(
      (candidate) => candidate.transaction.id === transactionRecordId,
    );
    return snapshot === undefined
      ? null
      : DurableAuthorizationSchema.parse(structuredClone(snapshot));
  }

  async consume(
    input: ConsumeTransferAuthorizationInput,
  ): Promise<PersistedTransferAuthorization | null> {
    return this.withLock(async () => {
      const state = await this.readState();
      const snapshot = state.authorizations[input.authorizationBindingId];
      if (
        snapshot === undefined ||
        !referencesMatch(snapshot, input) ||
        snapshot.binding.status !== "ACTIVE" ||
        snapshot.binding.exactIntentHash !== input.expectedExactIntentHash ||
        snapshot.transaction.idempotencyKey !== input.idempotencyKey ||
        snapshot.approval.decision !== "APPROVED" ||
        Date.parse(snapshot.approval.expiresAt) <= Date.parse(input.asOf)
      ) {
        return null;
      }

      const preConsumption = DurableAuthorizationSchema.parse(structuredClone(snapshot));
      state.authorizations[input.authorizationBindingId] =
        DurableAuthorizationSchema.parse({
          ...snapshot,
          binding: {
            ...snapshot.binding,
            status: "CONSUMED",
            consumedAt: input.asOf,
            consumedByTransactionId: input.transactionRecordId,
          },
        });
      await this.writeState(state);
      return preConsumption;
    });
  }

  async recordResult(result: TransferResult): Promise<void> {
    const parsed = TransferResultSchema.parse(structuredClone(result));
    if (!parsed.idempotencyKey) {
      throw new Error("TRANSFER_RESULT_IDEMPOTENCY_KEY_REQUIRED");
    }
    const idempotencyKey = parsed.idempotencyKey;
    await this.withLock(async () => {
      const state = await this.readState();
      const history = state.resultHistory[idempotencyKey] ?? [];
      if (canAppendResult(history, parsed)) {
        state.resultHistory[idempotencyKey] = [...history, parsed];
        state.latestResultKey = idempotencyKey;
        await this.writeState(state);
      }
    });
  }

  async loadLatestResult(): Promise<TransferResult | null> {
    const state = await this.readState();
    if (state.latestResultKey === null) {
      return null;
    }
    return this.lastResult(state.resultHistory[state.latestResultKey]);
  }

  async loadResult(idempotencyKey: string): Promise<TransferResult | null> {
    const state = await this.readState();
    return this.lastResult(state.resultHistory[idempotencyKey]);
  }

  async loadResultHistory(idempotencyKey: string): Promise<TransferResult[]> {
    const state = await this.readState();
    return (state.resultHistory[idempotencyKey] ?? []).map((result) =>
      TransferResultSchema.parse(structuredClone(result)),
    );
  }

  async recordReconciliation(record: DurableReconciliationRecord): Promise<void> {
    const parsed = DurableReconciliationRecordSchema.parse(structuredClone(record));
    await this.withLock(async () => {
      const state = await this.readState();
      const confirmed = state.resultHistory[parsed.idempotencyKey]?.at(-1);
      if (
        confirmed?.status !== "CONFIRMED" ||
        confirmed.proposalId !== parsed.proposalId ||
        confirmed.providerOperationId !== parsed.providerOperationId ||
        confirmed.transactionHash !== parsed.transactionHash ||
        confirmed.blockNumber !== parsed.blockNumber ||
        confirmed.blockHash !== parsed.blockHash ||
        confirmed.explorerUrl !== parsed.explorerUrl
      ) {
        throw new Error("RECONCILIATION_CONFIRMATION_MISMATCH");
      }
      const existing = state.reconciliations.find(
        (candidate) => candidate.idempotencyKey === parsed.idempotencyKey,
      );
      if (existing !== undefined) {
        const { reconciledAt: existingAt, ...existingEvidence } = existing;
        const { reconciledAt: parsedAt, ...parsedEvidence } = parsed;
        void existingAt;
        void parsedAt;
        if (sameValue(existingEvidence, parsedEvidence)) {
          return;
        }
        throw new Error("RECONCILIATION_ALREADY_RECORDED");
      }
      state.reconciliations.push(parsed);
      await this.writeState(state);
    });
  }

  async loadReconciliations(
    idempotencyKey: string,
  ): Promise<DurableReconciliationRecord[]> {
    const state = await this.readState();
    return state.reconciliations
      .filter((record) => record.idempotencyKey === idempotencyKey)
      .map((record) =>
        DurableReconciliationRecordSchema.parse(structuredClone(record)),
      );
  }

  async recordHandoff(result: HandoffResult): Promise<void> {
    const parsed = HandoffResultSchema.parse(structuredClone(result));
    await this.withLock(async () => {
      const state = await this.readState();
      const previous = state.handoffHistory.at(-1);
      if (!sameValue(previous, parsed)) {
        state.handoffHistory.push(parsed);
        await this.writeState(state);
      }
    });
  }

  async loadLatestHandoff(): Promise<HandoffResult | null> {
    const state = await this.readState();
    const latest = state.handoffHistory.at(-1);
    return latest === undefined
      ? null
      : HandoffResultSchema.parse(structuredClone(latest));
  }

  private lastResult(history: TransferResult[] | undefined): TransferResult | null {
    const result = history?.at(-1);
    return result === undefined
      ? null
      : TransferResultSchema.parse(structuredClone(result));
  }

  private async readState(): Promise<DurableState> {
    try {
      return migrateState(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return structuredClone(EMPTY_STATE);
      }
      throw error;
    }
  }

  private async writeState(state: DurableState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(DurableStateSchema.parse(state), null, 2), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, this.path);
  }

  private async inspectStaleLock(): Promise<StaleLockSnapshot | null> {
    try {
      const [lockStat, raw] = await Promise.all([
        stat(this.lockPath),
        readFile(this.lockPath, "utf8"),
      ]);
      if (Date.now() - lockStat.mtimeMs < LOCK_STALE_MS) {
        return null;
      }
      return {
        device: lockStat.dev,
        inode: lockStat.ino,
        mtimeMs: lockStat.mtimeMs,
        raw,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async acquireReclaimGuard(
    ownerToken: string,
  ): Promise<Awaited<ReturnType<typeof open>> | null> {
    try {
      const guard = await open(this.reclaimPath, "wx", 0o600);
      try {
        await guard.writeFile(
          JSON.stringify(
            LockMetadataSchema.parse({
              ownerToken,
              pid: process.pid,
              createdAt: new Date().toISOString(),
            }),
          ),
          "utf8",
        );
        await guard.sync();
      } catch (error) {
        await guard.close();
        await unlink(this.reclaimPath).catch(() => undefined);
        throw error;
      }
      return guard;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      try {
        const guardStat = await stat(this.reclaimPath);
        if (Date.now() - guardStat.mtimeMs >= LOCK_STALE_MS) {
          await unlink(this.reclaimPath);
        }
      } catch (guardError) {
        if ((guardError as NodeJS.ErrnoException).code !== "ENOENT") {
          throw guardError;
        }
      }
      return null;
    }
  }

  private async releaseReclaimGuard(ownerToken: string): Promise<void> {
    try {
      const metadata = parseLockMetadata(await readFile(this.reclaimPath, "utf8"));
      if (metadata?.ownerToken === ownerToken) {
        await unlink(this.reclaimPath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  private async quarantinedLockStillStale(
    snapshot: StaleLockSnapshot,
    quarantinePath: string,
  ): Promise<boolean> {
    const [quarantinedStat, quarantinedRaw] = await Promise.all([
      stat(quarantinePath),
      readFile(quarantinePath, "utf8"),
    ]);
    if (
      quarantinedStat.dev !== snapshot.device ||
      quarantinedStat.ino !== snapshot.inode ||
      quarantinedStat.mtimeMs !== snapshot.mtimeMs ||
      quarantinedRaw !== snapshot.raw ||
      Date.now() - quarantinedStat.mtimeMs < LOCK_STALE_MS
    ) {
      return false;
    }

    const finalLease = await stat(quarantinePath);
    return (
      finalLease.dev === snapshot.device &&
      finalLease.ino === snapshot.inode &&
      finalLease.mtimeMs === snapshot.mtimeMs &&
      Date.now() - finalLease.mtimeMs >= LOCK_STALE_MS
    );
  }

  private async reclaimStaleLock(): Promise<boolean> {
    const reclaimOwnerToken = randomUUID();
    const guard = await this.acquireReclaimGuard(reclaimOwnerToken);
    if (guard === null) {
      return false;
    }
    const quarantinePath = `${this.lockPath}.stale.${reclaimOwnerToken}`;
    let quarantineCreated = false;
    try {
      const snapshot = await this.inspectStaleLock();
      if (snapshot === null) {
        return false;
      }
      try {
        await link(this.lockPath, quarantinePath);
        quarantineCreated = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return false;
        }
        throw error;
      }

      if (!(await this.quarantinedLockStillStale(snapshot, quarantinePath))) {
        return false;
      }
      await unlink(this.lockPath);
      return true;
    } finally {
      if (quarantineCreated) {
        await unlink(quarantinePath).catch(() => undefined);
      }
      await guard.close();
      await this.releaseReclaimGuard(reclaimOwnerToken);
    }
  }

  private async renewOwnedLock(ownerToken: string): Promise<void> {
    try {
      const metadata = parseLockMetadata(await readFile(this.lockPath, "utf8"));
      if (metadata?.ownerToken === ownerToken) {
        const now = new Date();
        await utimes(this.lockPath, now, now);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  private async releaseOwnedLock(ownerToken: string): Promise<void> {
    try {
      const metadata = parseLockMetadata(await readFile(this.lockPath, "utf8"));
      if (metadata?.ownerToken === ownerToken) {
        await unlink(this.lockPath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const ownerToken = randomUUID();
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
      let lock;
      try {
        lock = await open(this.lockPath, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
        if (!(await this.reclaimStaleLock())) {
          await delay(LOCK_RETRY_MS);
        }
        continue;
      }

      try {
        await lock.writeFile(
          JSON.stringify(
            LockMetadataSchema.parse({
              ownerToken,
              pid: process.pid,
              createdAt: new Date().toISOString(),
            }),
          ),
          "utf8",
        );
        await lock.sync();
      } catch (error) {
        await lock.close();
        await unlink(this.lockPath).catch(() => undefined);
        throw error;
      }

      const heartbeat = setInterval(() => {
        void this.renewOwnedLock(ownerToken).catch(() => undefined);
      }, LOCK_HEARTBEAT_MS);
      try {
        return await operation();
      } finally {
        clearInterval(heartbeat);
        await lock.close();
        await this.releaseOwnedLock(ownerToken);
      }
    }
    throw new Error("AUTHORIZATION_STORE_LOCK_TIMEOUT");
  }
}
