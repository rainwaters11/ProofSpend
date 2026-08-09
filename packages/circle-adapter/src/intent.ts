import {
  RelationshipIntegrityError,
  validateExecutionAuthorization,
} from "@proofspend/domain";

import { ARC_TESTNET_CHAIN_ID, DEMO_TRANSFER_AMOUNT_ATOMIC } from "./types";
import type {
  ApprovedTransferIntent,
  PersistedTransferAuthorization,
  TransferFailureCode,
  TransferMode,
  TransferResult,
} from "./types";

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

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

export async function matchIntentToRecords(
  intent: ApprovedTransferIntent,
  authorization: PersistedTransferAuthorization | null,
  config: RevalidationConfig,
): Promise<Revalidation> {
  if (
    !intent.proposalId ||
    !intent.releaseRequestId ||
    !intent.approvalId ||
    !intent.authorizationBindingId ||
    !intent.transactionRecordId ||
    !intent.intentId ||
    !intent.idempotencyKey
  ) {
    return failure(
      "APPROVAL_MISSING",
      "The transfer request is missing persisted approval or authorization references.",
    );
  }
  if (intent.network !== "ARC-TESTNET" || intent.chainId !== ARC_TESTNET_CHAIN_ID) {
    return failure(
      "NETWORK_MISMATCH",
      "The transfer intent targets a network other than Arc Testnet.",
    );
  }
  if (
    intent.asset !== "USDC" ||
    intent.tokenContractAddress.toLowerCase() !== config.usdcTokenAddress.toLowerCase()
  ) {
    return failure(
      "TOKEN_MISMATCH",
      "The transfer intent targets a token other than the configured USDC contract.",
    );
  }
  if (intent.amountAtomic !== DEMO_TRANSFER_AMOUNT_ATOMIC) {
    return failure(
      "AMOUNT_MISMATCH",
      "The transfer intent must prepare and submit exactly 250 USDC.",
    );
  }
  if (config.sourceWalletId && intent.sourceWalletId !== config.sourceWalletId) {
    return failure(
      "WALLET_MISMATCH",
      "The transfer source wallet does not match the configured Arc Testnet wallet.",
    );
  }
  if (!EVM_ADDRESS_PATTERN.test(intent.destinationAddress)) {
    return failure(
      "WALLET_MISMATCH",
      "The transfer destination address is not a valid EVM address.",
    );
  }
  if (authorization === null) {
    return failure(
      "AUTHORIZATION_UNAVAILABLE",
      "The persisted transfer authorization is unavailable or no longer active.",
    );
  }

  const { approval, release, transaction, binding } = authorization;
  if (
    release.id !== intent.releaseRequestId ||
    release.id !== intent.proposalId ||
    approval.id !== intent.approvalId ||
    binding.id !== intent.authorizationBindingId ||
    transaction.id !== intent.transactionRecordId ||
    approval.intentId !== intent.intentId ||
    binding.intentId !== intent.intentId ||
    transaction.intentId !== intent.intentId ||
    transaction.idempotencyKey !== intent.idempotencyKey
  ) {
    return failure(
      "APPROVAL_ALTERED",
      "The transfer request does not match the persisted approval records.",
    );
  }
  if (approval.decision !== "APPROVED" || approval.decidedAt === null) {
    return failure("APPROVAL_MISSING", "The transfer does not have a completed approval.");
  }

  const canonicalIntent = binding.executionIntent;
  if (
    canonicalIntent.operationType !== "SETTLEMENT" ||
    canonicalIntent.protocolTarget.kind !== "DESTINATION" ||
    canonicalIntent.protocolTarget.isMock ||
    canonicalIntent.atomicAmount !== intent.amountAtomic ||
    canonicalIntent.asset !== intent.asset ||
    canonicalIntent.protocolTarget.network !== "ARC_TESTNET" ||
    canonicalIntent.protocolTarget.chainId !== intent.chainId ||
    canonicalIntent.protocolTarget.destination.toLowerCase() !==
      intent.destinationAddress.toLowerCase()
  ) {
    return failure(
      "APPROVAL_ALTERED",
      "The transfer request does not match the canonical approved execution intent.",
    );
  }

  return { ok: true };
}

export async function revalidateApprovedIntent(
  intent: ApprovedTransferIntent,
  authorization: PersistedTransferAuthorization | null,
  config: RevalidationConfig,
  asOf = new Date().toISOString(),
): Promise<Revalidation> {
  const structural = await matchIntentToRecords(intent, authorization, config);
  if (!structural.ok) {
    return structural;
  }
  if (authorization === null) {
    return failure(
      "AUTHORIZATION_UNAVAILABLE",
      "The persisted transfer authorization is unavailable or no longer active.",
    );
  }

  const { approval, release, transaction, binding } = authorization;
  if (Date.parse(approval.expiresAt) <= Date.parse(asOf)) {
    return failure("APPROVAL_EXPIRED", "The human approval for this transfer has expired.");
  }

  try {
    await validateExecutionAuthorization(
      approval,
      release,
      transaction,
      binding,
      asOf,
    );
  } catch (error) {
    if (error instanceof RelationshipIntegrityError) {
      return failure(
        "AUTHORIZATION_UNAVAILABLE",
        "The persisted transfer authorization is invalid or no longer active.",
      );
    }
    return failure(
      "AUTHORIZATION_UNAVAILABLE",
      "The persisted transfer authorization could not be validated.",
    );
  }

  return { ok: true };
}

export async function revalidateSubmittedTransfer(
  intent: ApprovedTransferIntent,
  authorization: PersistedTransferAuthorization | null,
  config: RevalidationConfig,
): Promise<Revalidation> {
  return matchIntentToRecords(intent, authorization, config);
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
