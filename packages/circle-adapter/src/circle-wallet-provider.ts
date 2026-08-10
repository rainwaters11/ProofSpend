import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import type { CircleDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

import { getCircleEnvironment } from "./env";
import { normalizeWalletError, WalletProviderError } from "./errors";
import {
  failureResult,
  preparedResult,
  revalidateApprovedIntent,
  revalidateSubmittedTransfer,
} from "./intent";
import type { Revalidation } from "./intent";
import type {
  ApprovedTransferIntent,
  ArcTestnetTransferProvider,
  TransferResult,
  TransferAuthorizationReferences,
  TransferAuthorizationStore,
  TransferWalletStatus,
  WalletBalance,
} from "./types";

export const USDC_DECIMALS = 6;

const TERMINAL_STATES: ReadonlySet<string> = new Set([
  "COMPLETE",
  "FAILED",
  "CANCELLED",
  "DENIED",
  "STUCK",
]);

const EVM_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidEvmHash(value: string | undefined): value is string {
  return typeof value === "string" && EVM_HASH_PATTERN.test(value);
}

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

type ReturnedTransaction = {
  blockchain?: string;
  walletId?: string;
  destinationAddress?: string;
  amounts?: string[];
  contractAddress?: string;
};

function verifyReturnedTransaction(
  intent: ApprovedTransferIntent,
  transaction: ReturnedTransaction,
  expected: {
    blockchain: string;
    sourceWalletId: string;
    usdcTokenAddress: string;
  },
): Extract<Revalidation, { ok: false }> | { ok: true } {
  if (transaction.blockchain !== expected.blockchain) {
    return {
      ok: false,
      failureCode: "NETWORK_MISMATCH",
      failureMessage: "The confirmed transaction is not on the configured Arc Testnet chain.",
    };
  }
  if (transaction.walletId !== expected.sourceWalletId) {
    return {
      ok: false,
      failureCode: "WALLET_MISMATCH",
      failureMessage: "The confirmed transaction source wallet does not match the exact intent.",
    };
  }
  if (
    !transaction.destinationAddress ||
    transaction.destinationAddress.toLowerCase() !== intent.destinationAddress.toLowerCase()
  ) {
    return {
      ok: false,
      failureCode: "WALLET_MISMATCH",
      failureMessage: "The confirmed transaction destination does not match the exact intent.",
    };
  }
  const expectedAmount = atomicToDecimal(intent.amountAtomic);
  if (
    !transaction.amounts ||
    transaction.amounts.length !== 1 ||
    transaction.amounts[0] !== expectedAmount
  ) {
    return {
      ok: false,
      failureCode: "AMOUNT_MISMATCH",
      failureMessage: "The confirmed transaction amount does not match the exact intent.",
    };
  }
  if (
    !transaction.contractAddress ||
    transaction.contractAddress.toLowerCase() !== expected.usdcTokenAddress.toLowerCase()
  ) {
    return {
      ok: false,
      failureCode: "TOKEN_MISMATCH",
      failureMessage: "The confirmed transaction token does not match the exact intent.",
    };
  }
  return { ok: true };
}

export interface CircleWalletProviderConfig {
  apiKey: string;
  entitySecret: string;
  sourceWalletId: string;
  destinationWalletId: string;
  authorizationStore: TransferAuthorizationStore;
  pollIntervalMs?: number;
  maxPolls?: number;
}

function authorizationReferences(intent: ApprovedTransferIntent): TransferAuthorizationReferences {
  return {
    releaseRequestId: intent.releaseRequestId,
    approvalId: intent.approvalId,
    authorizationBindingId: intent.authorizationBindingId,
    transactionRecordId: intent.transactionRecordId,
    intentId: intent.intentId,
  };
}

function atomicToDecimal(amountAtomic: string): string {
  const value = BigInt(amountAtomic);
  const divisor = 10n ** BigInt(USDC_DECIMALS);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) {
    return whole.toString();
  }
  const fractionText = fraction
    .toString()
    .padStart(USDC_DECIMALS, "0")
    .replace(/0+$/, "");
  return `${whole}.${fractionText}`;
}

function decimalToAtomic(amountDecimal: string): string {
  const [whole, fraction = ""] = amountDecimal.split(".");
  const paddedFraction = (fraction + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  return (
    BigInt(whole || "0") * 10n ** BigInt(USDC_DECIMALS) + BigInt(paddedFraction || "0")
  ).toString();
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class CircleWalletProvider implements ArcTestnetTransferProvider {
  private readonly client: CircleDeveloperControlledWalletsClient;
  private readonly sourceWalletId: string;
  private readonly destinationWalletId: string;
  private readonly authorizationStore: TransferAuthorizationStore;
  private readonly blockchain: string;
  private readonly usdcTokenAddress: string;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly arcscanBaseUrl: string;
  private readonly submittedKeys: Set<string> = new Set();

  constructor(config: CircleWalletProviderConfig) {
    if (
      !config.apiKey ||
      !config.entitySecret ||
      !config.sourceWalletId ||
      !config.destinationWalletId ||
      !config.authorizationStore
    ) {
      throw new WalletProviderError(
        "PROVIDER_UNAVAILABLE",
        "Circle adapter configuration is incomplete.",
      );
    }
    let environment;
    try {
      environment = getCircleEnvironment();
    } catch (error) {
      throw new WalletProviderError(
        "PROVIDER_UNAVAILABLE",
        "Circle adapter environment is incomplete.",
        { cause: error },
      );
    }
    this.client = initiateDeveloperControlledWalletsClient({
      apiKey: config.apiKey,
      entitySecret: config.entitySecret,
    });
    this.sourceWalletId = config.sourceWalletId;
    this.destinationWalletId = config.destinationWalletId;
    this.authorizationStore = config.authorizationStore;
    this.blockchain = environment.blockchain;
    this.usdcTokenAddress = environment.usdcTokenAddress;
    this.pollIntervalMs = config.pollIntervalMs ?? environment.pollIntervalMs;
    this.maxPolls = config.maxPolls ?? environment.maxPolls;
    this.arcscanBaseUrl = environment.arcscanBaseUrl;
  }

  async getStatus(): Promise<TransferWalletStatus> {
    try {
      const [source, destination] = await Promise.all([
        this.client.getWallet({ id: this.sourceWalletId }),
        this.client.getWallet({ id: this.destinationWalletId }),
      ]);
      const sourceWallet = source.data?.wallet;
      const destinationWallet = destination.data?.wallet;
      if (!sourceWallet || !destinationWallet) {
        return {
          mode: "ARC_TESTNET",
          state: "unavailable",
          sourceWalletId: this.sourceWalletId,
          destinationWalletId: this.destinationWalletId,
          reason: "A configured Arc Testnet wallet was not found.",
        };
      }
      return {
        mode: "ARC_TESTNET",
        state: "ready",
        sourceWalletId: sourceWallet.id,
        destinationWalletId: destinationWallet.id,
        sourceWalletAddress: sourceWallet.address,
        destinationWalletAddress: destinationWallet.address,
      };
    } catch {
      return {
        mode: "ARC_TESTNET",
        state: "unavailable",
        sourceWalletId: this.sourceWalletId,
        destinationWalletId: this.destinationWalletId,
      };
    }
  }

  async getBalance(): Promise<WalletBalance> {
    try {
      const response = await this.client.getWalletTokenBalance({
        id: this.sourceWalletId,
        includeAll: true,
        tokenAddresses: [this.usdcTokenAddress],
      });
      const balances = response.data?.tokenBalances ?? [];
      const usdc = balances.find(
        (balance) =>
          balance.token.tokenAddress?.toLowerCase() === this.usdcTokenAddress.toLowerCase(),
      );
      const amountDecimal = usdc?.amount ?? "0";
      return { asset: "USDC", amountAtomic: decimalToAtomic(amountDecimal) };
    } catch (error) {
      throw normalizeWalletError(error);
    }
  }

  async prepareTransfer(intent: ApprovedTransferIntent): Promise<TransferResult> {
    const authorization = await this.authorizationStore.load(authorizationReferences(intent));
    const revalidation = await revalidateApprovedIntent(
      intent,
      authorization,
      {
        usdcTokenAddress: this.usdcTokenAddress,
        sourceWalletId: this.sourceWalletId,
      },
    );
    if (!revalidation.ok) {
      return failureResult(intent, "ARC_TESTNET", revalidation);
    }
    return preparedResult(intent, "ARC_TESTNET");
  }

  async submitTransfer(intent: ApprovedTransferIntent): Promise<TransferResult> {
    if (this.submittedKeys.has(intent.proposalId) || this.submittedKeys.has(intent.idempotencyKey)) {
      return failureResult(intent, "ARC_TESTNET", {
        ok: false,
        failureCode: "DUPLICATE_SUBMISSION",
        failureMessage: "This proposal has already been submitted.",
      });
    }
    const initialAuthorization = await this.authorizationStore.load(
      authorizationReferences(intent),
    );
    const recoveringConsumedSubmission =
      initialAuthorization?.binding.status === "CONSUMED" &&
      initialAuthorization.binding.consumedByTransactionId === intent.transactionRecordId;
    const revalidation = recoveringConsumedSubmission
      ? await revalidateSubmittedTransfer(intent, initialAuthorization, {
          usdcTokenAddress: this.usdcTokenAddress,
          sourceWalletId: this.sourceWalletId,
        })
      : await revalidateApprovedIntent(intent, initialAuthorization, {
          usdcTokenAddress: this.usdcTokenAddress,
          sourceWalletId: this.sourceWalletId,
        });
    if (!revalidation.ok) {
      return failureResult(intent, "ARC_TESTNET", revalidation);
    }
    try {
      const [source, destination, balance] = await Promise.all([
        this.client.getWallet({ id: this.sourceWalletId }),
        this.client.getWallet({ id: this.destinationWalletId }),
        recoveringConsumedSubmission ? Promise.resolve(null) : this.getBalance(),
      ]);
      if (source.data?.wallet?.id !== this.sourceWalletId) {
        return failureResult(intent, "ARC_TESTNET", {
          ok: false,
          failureCode: "WALLET_MISMATCH",
          failureMessage:
            "The configured source wallet does not match the exact approved transfer intent.",
        });
      }
      const destinationAddress = destination.data?.wallet?.address;
      if (
        !destinationAddress ||
        destinationAddress.toLowerCase() !== intent.destinationAddress.toLowerCase()
      ) {
        return failureResult(intent, "ARC_TESTNET", {
          ok: false,
          failureCode: "WALLET_MISMATCH",
          failureMessage:
            "The destination address does not match the configured Arc Testnet destination wallet.",
        });
      }
      if (balance !== null && BigInt(balance.amountAtomic) < BigInt(intent.amountAtomic)) {
        return failureResult(intent, "ARC_TESTNET", {
          ok: false,
          failureCode: "INSUFFICIENT_BALANCE",
          failureMessage: "The configured source wallet has insufficient USDC for this transfer.",
        });
      }
      let submissionAuthorization = initialAuthorization;
      let submissionRevalidation: Revalidation;
      if (!recoveringConsumedSubmission) {
        const currentAuthorization = await this.authorizationStore.load(
          authorizationReferences(intent),
        );
        if (currentAuthorization === null) {
          return failureResult(intent, "ARC_TESTNET", {
            ok: false,
            failureCode: "AUTHORIZATION_UNAVAILABLE",
            failureMessage: "The persisted transfer authorization is unavailable.",
          });
        }
        const currentRevalidation = await revalidateApprovedIntent(
          intent,
          currentAuthorization,
          {
            usdcTokenAddress: this.usdcTokenAddress,
            sourceWalletId: this.sourceWalletId,
          },
        );
        if (!currentRevalidation.ok) {
          return failureResult(intent, "ARC_TESTNET", currentRevalidation);
        }
        const consumedAt = new Date().toISOString();
        submissionAuthorization = await this.authorizationStore.consume({
          ...authorizationReferences(intent),
          expectedExactIntentHash: currentAuthorization.binding.exactIntentHash,
          idempotencyKey: intent.idempotencyKey,
          asOf: consumedAt,
        });
        submissionRevalidation = await revalidateApprovedIntent(
          intent,
          submissionAuthorization,
          {
            usdcTokenAddress: this.usdcTokenAddress,
            sourceWalletId: this.sourceWalletId,
          },
          new Date().toISOString(),
        );
      } else if (
        submissionAuthorization?.binding.status !== "CONSUMED" ||
        submissionAuthorization.binding.consumedByTransactionId !== intent.transactionRecordId
      ) {
        return failureResult(intent, "ARC_TESTNET", {
          ok: false,
          failureCode: "AUTHORIZATION_UNAVAILABLE",
          failureMessage: "The consumed transfer authorization cannot be recovered safely.",
        });
      } else {
        submissionRevalidation = revalidation;
      }
      if (!submissionRevalidation.ok) {
        return failureResult(intent, "ARC_TESTNET", submissionRevalidation);
      }
      const response = await this.client.createTransaction({
        walletId: this.sourceWalletId,
        tokenAddress: this.usdcTokenAddress,
        amount: [atomicToDecimal(intent.amountAtomic)],
        destinationAddress: intent.destinationAddress,
        fee: { type: "level", config: { feeLevel: "MEDIUM" } },
        idempotencyKey: intent.idempotencyKey,
        refId: intent.proposalId,
      });
      const transactionId = response.data?.id;
      if (!transactionId) {
        throw new WalletProviderError("INVALID_REQUEST", "Circle did not return a transaction id.");
      }
      if (!isValidUuid(transactionId)) {
        throw new WalletProviderError(
          "INVALID_REQUEST",
          "Circle returned a malformed transaction id; refusing to record an invalid provider operation.",
        );
      }
      this.submittedKeys.add(intent.proposalId);
      this.submittedKeys.add(intent.idempotencyKey);
      return {
        proposalId: intent.proposalId,
        idempotencyKey: intent.idempotencyKey,
        mode: "ARC_TESTNET",
        status: "SUBMITTED",
        providerOperationId: transactionId,
        polledAt: new Date().toISOString(),
      };
    } catch (error) {
      throw normalizeWalletError(error);
    }
  }

  async pollTransfer(
    intent: ApprovedTransferIntent,
    providerOperationId: string,
  ): Promise<TransferResult> {
    if (!isValidUuid(providerOperationId)) {
      throw new WalletProviderError(
        "INVALID_REQUEST",
        "The Circle provider operation id must be a UUID.",
      );
    }
    const authorization = await this.authorizationStore.load(
      authorizationReferences(intent),
    );
    const revalidation = await revalidateSubmittedTransfer(intent, authorization, {
      usdcTokenAddress: this.usdcTokenAddress,
      sourceWalletId: this.sourceWalletId,
    });
    if (!revalidation.ok) {
      return failureResult(intent, "ARC_TESTNET", revalidation);
    }
    try {
      let state = "";
      let txHash: string | undefined;
      let blockNumber: number | undefined;
      let blockHash: string | undefined;
      let returnedTransaction: ReturnedTransaction | undefined;
      let polls = 0;

      while (polls < this.maxPolls) {
        await sleep(this.pollIntervalMs);
        const transaction = (await this.client.getTransaction({ id: providerOperationId })).data
          ?.transaction;
        if (transaction) {
          returnedTransaction = transaction;
          state = transaction.state ?? state;
          if (isValidEvmHash(transaction.txHash)) {
            txHash = transaction.txHash;
          }
          if (
            typeof transaction.blockHeight === "number" &&
            Number.isInteger(transaction.blockHeight) &&
            transaction.blockHeight > 0
          ) {
            blockNumber = transaction.blockHeight;
          }
          if (isValidEvmHash(transaction.blockHash)) {
            blockHash = transaction.blockHash;
          }
        }
        polls++;
        if (state === "COMPLETE" && txHash && blockNumber && blockHash) {
          if (returnedTransaction) {
            const verification = verifyReturnedTransaction(
              intent,
              returnedTransaction,
              {
                blockchain: this.blockchain,
                sourceWalletId: this.sourceWalletId,
                usdcTokenAddress: this.usdcTokenAddress,
              },
            );
            if (!verification.ok) {
              return failureResult(intent, "ARC_TESTNET", verification);
            }
          }
          return {
            mode: "ARC_TESTNET",
            status: "CONFIRMED",
            providerOperationId,
            transactionHash: txHash,
            blockNumber,
            blockHash,
            explorerUrl: `${this.arcscanBaseUrl}/tx/${txHash}`,
            polledAt: new Date().toISOString(),
          };
        }
        if (TERMINAL_STATES.has(state) && state !== "COMPLETE") {
          return {
            mode: "ARC_TESTNET",
            status: "FAILED",
            providerOperationId,
            transactionHash: txHash,
            explorerUrl: txHash ? `${this.arcscanBaseUrl}/tx/${txHash}` : undefined,
            polledAt: new Date().toISOString(),
          };
        }
      }

      return {
        mode: "ARC_TESTNET",
        status: "SUBMITTED",
        providerOperationId,
        transactionHash: txHash,
        explorerUrl: txHash ? `${this.arcscanBaseUrl}/tx/${txHash}` : undefined,
        failureCode:
          state === "COMPLETE" ? "CONFIRMATION_INCOMPLETE" : "POLLING_TIMEOUT",
        failureMessage:
          state === "COMPLETE"
            ? "Circle reported completion without complete confirmation evidence; polling can resume."
            : "Transaction remains submitted after the polling window; polling can resume.",
        polledAt: new Date().toISOString(),
      };
    } catch (error) {
      throw normalizeWalletError(error);
    }
  }
}
