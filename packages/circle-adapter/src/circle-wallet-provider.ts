import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import type { CircleDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

import { getCircleEnvironment } from "./env";
import { normalizeWalletError, WalletProviderError } from "./errors";
import type {
  PaymentPreparation,
  PaymentResult,
  WalletBalance,
  WalletProvider,
  WalletStatus,
} from "./types";

export const USDC_DECIMALS = 6;

const TERMINAL_STATES: ReadonlySet<string> = new Set([
  "COMPLETE",
  "FAILED",
  "CANCELLED",
  "DENIED",
  "STUCK",
]);

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

export interface CircleWalletProviderConfig {
  apiKey: string;
  entitySecret: string;
  sourceWalletId: string;
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

function validatePayment(payment: PaymentPreparation, blockchain: string): void {
  if (payment.chain !== blockchain) {
    throw new WalletProviderError("INVALID_REQUEST", "Unsupported blockchain.");
  }
  if (payment.asset !== "USDC") {
    throw new WalletProviderError("INVALID_REQUEST", "Unsupported asset.");
  }
  if (!EVM_ADDRESS_PATTERN.test(payment.destinationAddress)) {
    throw new WalletProviderError("INVALID_REQUEST", "Invalid destination address.");
  }
  if (!POSITIVE_INTEGER_PATTERN.test(payment.amountAtomic)) {
    throw new WalletProviderError("INVALID_REQUEST", "Invalid amount.");
  }
  if (!payment.idempotencyKey) {
    throw new WalletProviderError("INVALID_REQUEST", "Missing idempotency key.");
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class CircleWalletProvider implements WalletProvider {
  private readonly client: CircleDeveloperControlledWalletsClient;
  private readonly sourceWalletId: string;
  private readonly blockchain: string;
  private readonly usdcTokenAddress: string;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly arcscanBaseUrl: string;

  constructor(config: CircleWalletProviderConfig) {
    if (!config.apiKey || !config.entitySecret || !config.sourceWalletId) {
      throw new WalletProviderError("PROVIDER_UNAVAILABLE", "Circle adapter configuration is incomplete.");
    }
    let environment;
    try {
      environment = getCircleEnvironment();
    } catch (error) {
      throw new WalletProviderError("PROVIDER_UNAVAILABLE", "Circle adapter environment is incomplete.", {
        cause: error,
      });
    }
    this.client = initiateDeveloperControlledWalletsClient({
      apiKey: config.apiKey,
      entitySecret: config.entitySecret,
    });
    this.sourceWalletId = config.sourceWalletId;
    this.blockchain = environment.blockchain;
    this.usdcTokenAddress = environment.usdcTokenAddress;
    this.pollIntervalMs = config.pollIntervalMs ?? environment.pollIntervalMs;
    this.maxPolls = config.maxPolls ?? environment.maxPolls;
    this.arcscanBaseUrl = environment.arcscanBaseUrl;
  }

  async getStatus(): Promise<WalletStatus> {
    try {
      await this.client.listWallets();
      return { mode: "circle", state: "ready" };
    } catch {
      return { mode: "circle", state: "unavailable" };
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

  async preparePayment(payment: PaymentPreparation): Promise<PaymentPreparation> {
    validatePayment(payment, this.blockchain);
    return { ...payment };
  }

  async executePayment(payment: PaymentPreparation): Promise<PaymentResult> {
    validatePayment(payment, this.blockchain);
    try {
      const amountDecimal = atomicToDecimal(payment.amountAtomic);
      const response = await this.client.createTransaction({
        walletId: this.sourceWalletId,
        tokenAddress: this.usdcTokenAddress,
        amount: [amountDecimal],
        destinationAddress: payment.destinationAddress,
        fee: { type: "level", config: { feeLevel: "MEDIUM" } },
        idempotencyKey: payment.idempotencyKey,
      });
      const transactionId = response.data?.id;
      if (!transactionId) {
        throw new WalletProviderError("INVALID_REQUEST", "Circle did not return a transaction id.");
      }

      let state = response.data?.state ?? "";
      let txHash: string | undefined;
      let polls = 0;

      while (!TERMINAL_STATES.has(state) && polls < this.maxPolls) {
        await sleep(this.pollIntervalMs);
        const transaction = (await this.client.getTransaction({ id: transactionId })).data?.transaction;
        if (transaction) {
          state = transaction.state ?? state;
          txHash = transaction.txHash ?? txHash;
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
        idempotencyKey: payment.idempotencyKey,
        mode: "circle",
        status: confirmed ? "confirmed" : "failed",
        transactionId,
        transactionHash: txHash ?? null,
        explorerUrl: txHash ? `${this.arcscanBaseUrl}/tx/${txHash}` : null,
        terminalState: state,
      };
    } catch (error) {
      throw normalizeWalletError(error);
    }
  }
}
