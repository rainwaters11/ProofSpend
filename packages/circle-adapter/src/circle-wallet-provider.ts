import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import type { CircleDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

import { getCircleEnvironment } from "./env";
import { normalizeWalletError, WalletProviderError } from "./errors";
import { failureResult, preparedResult, revalidateApprovedIntent } from "./intent";
import type {
  ApprovedTransferIntent,
  ArcTestnetTransferProvider,
  TransferResult,
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

function isValidEvmHash(value: string | undefined): value is string {
  return typeof value === "string" && EVM_HASH_PATTERN.test(value);
}

export interface CircleWalletProviderConfig {
  apiKey: string;
  entitySecret: string;
  sourceWalletId: string;
  destinationWalletId: string;
  pollIntervalMs?: number;
  maxPolls?: number;
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
      !config.destinationWalletId
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
    const revalidation = revalidateApprovedIntent(intent, {
      usdcTokenAddress: this.usdcTokenAddress,
      sourceWalletId: this.sourceWalletId,
    });
    if (!revalidation.ok) {
      return failureResult(intent, "ARC_TESTNET", revalidation);
    }
    return preparedResult(intent, "ARC_TESTNET");
  }

  async submitTransfer(intent: ApprovedTransferIntent): Promise<TransferResult> {
    const revalidation = revalidateApprovedIntent(intent, {
      usdcTokenAddress: this.usdcTokenAddress,
      sourceWalletId: this.sourceWalletId,
    });
    if (!revalidation.ok) {
      return failureResult(intent, "ARC_TESTNET", revalidation);
    }
    if (this.submittedKeys.has(intent.proposalId) || this.submittedKeys.has(intent.idempotencyKey)) {
      return failureResult(intent, "ARC_TESTNET", {
        ok: false,
        failureCode: "DUPLICATE_SUBMISSION",
        failureMessage: "This proposal has already been submitted.",
      });
    }
    try {
      const destination = await this.client.getWallet({ id: this.destinationWalletId });
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
      this.submittedKeys.add(intent.proposalId);
      this.submittedKeys.add(intent.idempotencyKey);
      return {
        proposalId: intent.proposalId,
        idempotencyKey: intent.idempotencyKey,
        mode: "ARC_TESTNET",
        status: "SUBMITTED",
        transactionId,
        polledAt: new Date().toISOString(),
      };
    } catch (error) {
      throw normalizeWalletError(error);
    }
  }

  async pollTransfer(transactionId: string): Promise<TransferResult> {
    try {
      let state = "";
      let txHash: string | undefined;
      let blockNumber: number | undefined;
      let blockHash: string | undefined;
      let polls = 0;

      while (!TERMINAL_STATES.has(state) && polls < this.maxPolls) {
        await sleep(this.pollIntervalMs);
        const transaction = (await this.client.getTransaction({ id: transactionId })).data
          ?.transaction;
        if (transaction) {
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
      }

      if (!TERMINAL_STATES.has(state)) {
        throw new WalletProviderError(
          "PROVIDER_UNAVAILABLE",
          `Transaction polling timed out after ${this.maxPolls} polls.`,
        );
      }

      const confirmed = state === "COMPLETE";
      return {
        mode: "ARC_TESTNET",
        status: confirmed ? "CONFIRMED" : "FAILED",
        transactionId,
        transactionHash: isValidEvmHash(txHash) ? txHash : undefined,
        blockNumber,
        blockHash,
        explorerUrl: isValidEvmHash(txHash) ? `${this.arcscanBaseUrl}/tx/${txHash}` : undefined,
        polledAt: new Date().toISOString(),
      };
    } catch (error) {
      throw normalizeWalletError(error);
    }
  }
}
