import { createHash } from "node:crypto";

import { ARC_TESTNET_CHAIN_ID, DEMO_TRANSFER_AMOUNT_ATOMIC } from "./types";
import type {
  ApprovedTransferIntent,
  TransferFailureCode,
  TransferMode,
  TransferResult,
} from "./types";

export const INTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeExactIntentHash(
  intent: Omit<ApprovedTransferIntent, "exactIntentHash">,
): string {
  return `sha256:${createHash("sha256").update(canonicalize(intent), "utf8").digest("hex")}`;
}

export type RevalidationConfig = {
  usdcTokenAddress: string;
  sourceWalletId?: string;
};

export type Revalidation =
  | { ok: true }
  | { ok: false; failureCode: TransferFailureCode; failureMessage: string };

function failure(failureCode: TransferFailureCode, failureMessage: string): Revalidation {
  return { ok: false, failureCode, failureMessage };
}

export function revalidateApprovedIntent(
  intent: ApprovedTransferIntent,
  config: RevalidationConfig,
): Revalidation {
  const { exactIntentHash, ...fields } = intent;
  if (!fields.proposalId || !fields.approvalReference || !fields.idempotencyKey) {
    return failure(
      "APPROVAL_MISSING",
      "The approved transfer intent is missing its proposal or approval fields.",
    );
  }
  if (!INTENT_HASH_PATTERN.test(exactIntentHash) || computeExactIntentHash(fields) !== exactIntentHash) {
    return failure(
      "APPROVAL_ALTERED",
      "The transfer intent does not match the exact approved intent.",
    );
  }
  if (fields.network !== "ARC-TESTNET" || fields.chainId !== ARC_TESTNET_CHAIN_ID) {
    return failure(
      "NETWORK_MISMATCH",
      "The transfer intent targets a network other than Arc Testnet.",
    );
  }
  if (
    fields.asset !== "USDC" ||
    fields.tokenContractAddress.toLowerCase() !== config.usdcTokenAddress.toLowerCase()
  ) {
    return failure(
      "TOKEN_MISMATCH",
      "The transfer intent targets a token other than the configured USDC contract.",
    );
  }
  if (fields.amountAtomic !== DEMO_TRANSFER_AMOUNT_ATOMIC) {
    return failure(
      "AMOUNT_MISMATCH",
      "The transfer intent must prepare and submit exactly 250 USDC.",
    );
  }
  if (config.sourceWalletId && fields.sourceWalletId !== config.sourceWalletId) {
    return failure(
      "WALLET_MISMATCH",
      "The transfer source wallet does not match the configured Arc Testnet wallet.",
    );
  }
  if (!EVM_ADDRESS_PATTERN.test(fields.destinationAddress)) {
    return failure(
      "WALLET_MISMATCH",
      "The transfer destination address is not a valid EVM address.",
    );
  }
  const decidedAt = Date.parse(fields.decidedAt);
  const expiresAt = Date.parse(fields.expiresAt);
  if (Number.isNaN(decidedAt) || Number.isNaN(expiresAt)) {
    return failure(
      "APPROVAL_MISSING",
      "The approved transfer intent has invalid approval timestamps.",
    );
  }
  if (decidedAt > Date.now()) {
    return failure(
      "APPROVAL_ALTERED",
      "The approval timestamp is in the future.",
    );
  }
  if (expiresAt <= Date.now()) {
    return failure("APPROVAL_EXPIRED", "The human approval for this transfer has expired.");
  }
  if (decidedAt > expiresAt) {
    return failure(
      "APPROVAL_ALTERED",
      "The approval timestamps are inconsistent.",
    );
  }
  return { ok: true };
}

export function preparedResult(intent: ApprovedTransferIntent, mode: TransferMode): TransferResult {
  return {
    proposalId: intent.proposalId,
    idempotencyKey: intent.idempotencyKey,
    mode,
    status: "PREPARED",
    polledAt: new Date().toISOString(),
  };
}

export function failureResult(
  intent: ApprovedTransferIntent,
  mode: TransferMode,
  revalidation: Extract<Revalidation, { ok: false }>,
): TransferResult {
  return {
    proposalId: intent.proposalId,
    idempotencyKey: intent.idempotencyKey,
    mode,
    status: "FAILED",
    failureCode: revalidation.failureCode,
    failureMessage: revalidation.failureMessage,
    polledAt: new Date().toISOString(),
  };
}
