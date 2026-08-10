import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
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

const DurableStateSchema = z
  .object({
    version: z.literal(1),
    authorizations: z.record(z.string(), DurableAuthorizationSchema),
    results: z.record(z.string(), TransferResultSchema),
    latestResultKey: z.string().nullable(),
    latestHandoff: HandoffResultSchema.nullable(),
  })
  .strict();

type DurableState = z.infer<typeof DurableStateSchema>;

const EMPTY_STATE: DurableState = {
  version: 1,
  authorizations: {},
  results: {},
  latestResultKey: null,
  latestHandoff: null,
};

const LOCK_RETRIES = 100;
const LOCK_RETRY_MS = 10;

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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class FileTransferAuthorizationStore implements TransferAuthorizationStore {
  readonly path: string;
  private readonly lockPath: string;

  constructor(path: string) {
    if (!path.trim()) {
      throw new Error("AUTHORIZATION_STORE_PATH_REQUIRED");
    }
    this.path = path;
    this.lockPath = `${path}.lock`;
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
    await this.withLock(async () => {
      const state = await this.readState();
      state.results[parsed.idempotencyKey!] = parsed;
      state.latestResultKey = parsed.idempotencyKey!;
      await this.writeState(state);
    });
  }

  async loadLatestResult(): Promise<TransferResult | null> {
    const state = await this.readState();
    if (state.latestResultKey === null) {
      return null;
    }
    const result = state.results[state.latestResultKey];
    return result === undefined ? null : TransferResultSchema.parse(structuredClone(result));
  }

  async recordHandoff(result: HandoffResult): Promise<void> {
    const parsed = HandoffResultSchema.parse(structuredClone(result));
    await this.withLock(async () => {
      const state = await this.readState();
      state.latestHandoff = parsed;
      await this.writeState(state);
    });
  }

  async loadLatestHandoff(): Promise<HandoffResult | null> {
    const state = await this.readState();
    return state.latestHandoff === null
      ? null
      : HandoffResultSchema.parse(structuredClone(state.latestHandoff));
  }

  private async readState(): Promise<DurableState> {
    try {
      return DurableStateSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
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

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
      try {
        const lock = await open(this.lockPath, "wx", 0o600);
        try {
          return await operation();
        } finally {
          await lock.close();
          await unlink(this.lockPath).catch(() => undefined);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
        await delay(LOCK_RETRY_MS);
      }
    }
    throw new Error("AUTHORIZATION_STORE_LOCK_TIMEOUT");
  }
}
