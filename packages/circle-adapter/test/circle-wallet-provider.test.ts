import { beforeEach, describe, expect, it, vi } from "vitest";

import { CircleWalletProvider, USDC_DECIMALS } from "../src/circle-wallet-provider";
import { getCircleEnvironment } from "../src/env";
import { WalletProviderError } from "../src/errors";
import { computeExactIntentHash } from "../src/intent";
import type { ApprovedTransferIntent } from "../src/types";

const mockedClient = vi.hoisted(() => ({
  getWallet: vi.fn(),
  getWalletTokenBalance: vi.fn(),
  createTransaction: vi.fn(),
  getTransaction: vi.fn(),
}));

vi.mock("@circle-fin/developer-controlled-wallets", () => ({
  initiateDeveloperControlledWalletsClient: () => mockedClient,
}));

const circleEnvironment = {
  CIRCLE_CHAIN: "ARC-TESTNET",
  CIRCLE_USDC_TOKEN_ADDRESS: "0x3600000000000000000000000000000000000000",
  CIRCLE_POLL_INTERVAL_MS: "1",
  CIRCLE_MAX_POLLS: "3",
  CIRCLE_ARGSCAN_BASE_URL: "https://testnet.arcscan.app",
};

type IntentFields = Omit<ApprovedTransferIntent, "exactIntentHash">;

const baseIntent: IntentFields = {
  proposalId: "proposal-1",
  approvalReference: "approval-1",
  idempotencyKey: "demo-payment-1",
  network: "ARC-TESTNET",
  chainId: "5042002",
  asset: "USDC",
  tokenContractAddress: circleEnvironment.CIRCLE_USDC_TOKEN_ADDRESS,
  amountAtomic: "250000000",
  sourceWalletId: "wallet-123",
  destinationAddress: "0x0000000000000000000000000000000000000001",
  decidedAt: "2026-08-08T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

function validIntent(overrides: Record<string, unknown> = {}): ApprovedTransferIntent {
  const intent = { ...baseIntent, ...overrides } as IntentFields;
  return { ...intent, exactIntentHash: computeExactIntentHash(intent) };
}

function alteredIntent(overrides: Record<string, unknown>): ApprovedTransferIntent {
  const intent = { ...baseIntent, ...overrides } as IntentFields;
  return { ...intent, exactIntentHash: computeExactIntentHash(baseIntent) };
}

function makeProvider(overrides: Partial<Record<string, unknown>> = {}): CircleWalletProvider {
  return new CircleWalletProvider({
    apiKey: "test-api-key",
    entitySecret: "test-entity-secret",
    sourceWalletId: "wallet-123",
    destinationWalletId: "wallet-dest",
    ...overrides,
  });
}

function mockDestinationWallet(): void {
  mockedClient.getWallet.mockResolvedValue({
    data: { wallet: { id: "wallet-dest", address: baseIntent.destinationAddress } },
  });
}

describe("CircleWalletProvider", () => {
  beforeEach(() => {
    vi.stubEnv("CIRCLE_CHAIN", circleEnvironment.CIRCLE_CHAIN);
    vi.stubEnv("CIRCLE_USDC_TOKEN_ADDRESS", circleEnvironment.CIRCLE_USDC_TOKEN_ADDRESS);
    vi.stubEnv("CIRCLE_POLL_INTERVAL_MS", circleEnvironment.CIRCLE_POLL_INTERVAL_MS);
    vi.stubEnv("CIRCLE_MAX_POLLS", circleEnvironment.CIRCLE_MAX_POLLS);
    vi.stubEnv("CIRCLE_ARGSCAN_BASE_URL", circleEnvironment.CIRCLE_ARGSCAN_BASE_URL);
    mockedClient.getWallet.mockReset();
    mockedClient.getWalletTokenBalance.mockReset();
    mockedClient.createTransaction.mockReset();
    mockedClient.getTransaction.mockReset();
  });

  it("rejects incomplete configuration without touching the network", () => {
    expect(
      () => new CircleWalletProvider({ apiKey: "", entitySecret: "secret", sourceWalletId: "w", destinationWalletId: "d" }),
    ).toThrow(WalletProviderError);
    expect(
      () => new CircleWalletProvider({ apiKey: "key", entitySecret: "", sourceWalletId: "w", destinationWalletId: "d" }),
    ).toThrow(WalletProviderError);
    expect(
      () => new CircleWalletProvider({ apiKey: "key", entitySecret: "secret", sourceWalletId: "", destinationWalletId: "d" }),
    ).toThrow(WalletProviderError);
    expect(
      () => new CircleWalletProvider({ apiKey: "key", entitySecret: "secret", sourceWalletId: "w", destinationWalletId: "" }),
    ).toThrow(WalletProviderError);
  });

  it("reports ready only when both configured Arc wallets resolve", async () => {
    mockedClient.getWallet
      .mockResolvedValueOnce({
        data: { wallet: { id: "wallet-123", address: "0x0000000000000000000000000000000000000001" } },
      })
      .mockResolvedValueOnce({
        data: { wallet: { id: "wallet-dest", address: "0x0000000000000000000000000000000000000002" } },
      });

    await expect(makeProvider().getStatus()).resolves.toEqual({
      mode: "ARC_TESTNET",
      state: "ready",
      sourceWalletId: "wallet-123",
      destinationWalletId: "wallet-dest",
      sourceWalletAddress: "0x0000000000000000000000000000000000000001",
      destinationWalletAddress: "0x0000000000000000000000000000000000000002",
    });
  });

  it("reports unavailable when the Circle API cannot be reached", async () => {
    mockedClient.getWallet.mockRejectedValue(new Error("network down"));

    await expect(makeProvider().getStatus()).resolves.toEqual({
      mode: "ARC_TESTNET",
      state: "unavailable",
      sourceWalletId: "wallet-123",
      destinationWalletId: "wallet-dest",
    });
  });

  it("reports unavailable when a configured wallet is not found", async () => {
    mockedClient.getWallet.mockResolvedValue({ data: { wallet: undefined } });

    const status = await makeProvider().getStatus();
    expect(status.state).toBe("unavailable");
    expect(status.reason).toBeTruthy();
  });

  it("converts a decimal USDC balance to atomic units", async () => {
    const usdcTokenAddress = getCircleEnvironment().usdcTokenAddress;
    mockedClient.getWalletTokenBalance.mockResolvedValue({
      data: {
        tokenBalances: [
          {
            amount: "1.25",
            token: { tokenAddress: usdcTokenAddress },
          },
        ],
      },
    });

    await expect(makeProvider().getBalance()).resolves.toEqual({
      asset: "USDC",
      amountAtomic: "1250000",
    });
  });

  it("returns a zero atomic balance when the USDC token is absent", async () => {
    mockedClient.getWalletTokenBalance.mockResolvedValue({ data: { tokenBalances: [] } });

    await expect(makeProvider().getBalance()).resolves.toEqual({
      asset: "USDC",
      amountAtomic: "0",
    });
  });

  it("normalizes a balance failure without leaking details", async () => {
    mockedClient.getWalletTokenBalance.mockRejectedValue(new Error("sensitive upstream detail"));

    const error = await makeProvider().getBalance().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletProviderError);
    expect((error as WalletProviderError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((error as WalletProviderError).message).toBe("Wallet provider request failed.");
  });

  it("prepares an approved intent without touching the network", async () => {
    const result = await makeProvider().prepareTransfer(validIntent());

    expect(result).toEqual({
      proposalId: "proposal-1",
      idempotencyKey: "demo-payment-1",
      mode: "ARC_TESTNET",
      status: "PREPARED",
      polledAt: expect.any(String),
    });
    expect(mockedClient.createTransaction).not.toHaveBeenCalled();
    expect(mockedClient.getWallet).not.toHaveBeenCalled();
  });

  it("rejects preparation when the amount is not exactly 250 USDC", async () => {
    const result = await makeProvider().prepareTransfer(
      validIntent({ amountAtomic: "1000000" }),
    );

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("AMOUNT_MISMATCH");
  });

  it("rejects preparation when the intent differs from the approved hash", async () => {
    const result = await makeProvider().prepareTransfer(alteredIntent({ destinationAddress: "0x0000000000000000000000000000000000000002" }));

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("APPROVAL_ALTERED");
  });

  it("rejects preparation when the approval has expired", async () => {
    const result = await makeProvider().prepareTransfer(
      validIntent({ expiresAt: "2020-01-01T00:00:00.000Z" }),
    );

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("APPROVAL_EXPIRED");
  });

  it("rejects preparation when the network does not match Arc Testnet", async () => {
    const result = await makeProvider().prepareTransfer(
      validIntent({ network: "ETHEREUM" }),
    );

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("NETWORK_MISMATCH");
  });

  it("rejects preparation when the token does not match the configured USDC contract", async () => {
    const result = await makeProvider().prepareTransfer(
      validIntent({ tokenContractAddress: "0x0000000000000000000000000000000000000000" }),
    );

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("TOKEN_MISMATCH");
  });

  it("rejects preparation when the source wallet does not match the configured wallet", async () => {
    const result = await makeProvider().prepareTransfer(
      validIntent({ sourceWalletId: "wallet-other" }),
    );

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("WALLET_MISMATCH");
  });

  it("rejects preparation when approval fields are missing", async () => {
    const result = await makeProvider().prepareTransfer(alteredIntent({ approvalReference: "" }));

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("APPROVAL_MISSING");
  });

  it("submits an approved intent and returns a submitted result with a transaction id", async () => {
    const usdcTokenAddress = getCircleEnvironment().usdcTokenAddress;
    mockDestinationWallet();
    mockedClient.createTransaction.mockResolvedValue({ data: { id: "tx-1", state: "SENT" } });

    const result = await makeProvider().submitTransfer(validIntent());

    expect(mockedClient.createTransaction).toHaveBeenCalledWith({
      walletId: "wallet-123",
      tokenAddress: usdcTokenAddress,
      amount: ["250"],
      destinationAddress: baseIntent.destinationAddress,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      idempotencyKey: "demo-payment-1",
      refId: "proposal-1",
    });
    expect(result).toEqual({
      proposalId: "proposal-1",
      idempotencyKey: "demo-payment-1",
      mode: "ARC_TESTNET",
      status: "SUBMITTED",
      transactionId: "tx-1",
      polledAt: expect.any(String),
    });
  });

  it("rejects a duplicate submission without touching the network again", async () => {
    mockDestinationWallet();
    mockedClient.createTransaction.mockResolvedValue({ data: { id: "tx-1", state: "SENT" } });
    const provider = makeProvider();
    const intent = validIntent();

    await provider.submitTransfer(intent);
    const second = await provider.submitTransfer(intent);

    expect(second.status).toBe("FAILED");
    expect(second.failureCode).toBe("DUPLICATE_SUBMISSION");
    expect(mockedClient.createTransaction).toHaveBeenCalledTimes(1);
  });

  it("rejects submission when the destination does not match the configured destination wallet", async () => {
    mockedClient.getWallet.mockResolvedValue({
      data: { wallet: { id: "wallet-dest", address: "0x0000000000000000000000000000000000000002" } },
    });
    mockedClient.createTransaction.mockResolvedValue({ data: { id: "tx-1", state: "SENT" } });

    const result = await makeProvider().submitTransfer(validIntent());

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("WALLET_MISMATCH");
    expect(mockedClient.createTransaction).not.toHaveBeenCalled();
  });

  it("rejects submission when the approved amount changed before submission", async () => {
    mockDestinationWallet();

    const result = await makeProvider().submitTransfer(validIntent({ amountAtomic: "1000000" }));

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("AMOUNT_MISMATCH");
    expect(mockedClient.createTransaction).not.toHaveBeenCalled();
  });

  it("throws a normalized error when the transfer submission fails", async () => {
    mockDestinationWallet();
    mockedClient.createTransaction.mockRejectedValue(new Error("sensitive upstream detail"));

    const error = await makeProvider().submitTransfer(validIntent()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletProviderError);
    expect((error as WalletProviderError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((error as WalletProviderError).message).toBe("Wallet provider request failed.");
  });

  it("throws a normalized error when Circle omits the transaction id", async () => {
    mockDestinationWallet();
    mockedClient.createTransaction.mockResolvedValue({ data: {} });

    const error = await makeProvider().submitTransfer(validIntent()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletProviderError);
    expect((error as WalletProviderError).code).toBe("INVALID_REQUEST");
    expect((error as WalletProviderError).message).toBe("Circle did not return a transaction id.");
  });

  it("polls to confirmed and returns real transaction metadata", async () => {
    const arcscanBaseUrl = getCircleEnvironment().arcscanBaseUrl;
    const transactionHash = `0x${"1a".repeat(32)}`;
    const blockHash = `0x${"2b".repeat(32)}`;
    mockedClient.getTransaction.mockResolvedValue({
      data: {
        transaction: {
          state: "COMPLETE",
          txHash: transactionHash,
          blockHeight: 42,
          blockHash,
        },
      },
    });

    const result = await makeProvider().pollTransfer("tx-1");

    expect(mockedClient.getTransaction).toHaveBeenCalledWith({ id: "tx-1" });
    expect(result).toEqual({
      mode: "ARC_TESTNET",
      status: "CONFIRMED",
      transactionId: "tx-1",
      transactionHash,
      blockNumber: 42,
      blockHash,
      explorerUrl: `${arcscanBaseUrl}/tx/${transactionHash}`,
      polledAt: expect.any(String),
    });
  });

  it("returns a failed poll result for a terminal failure state", async () => {
    mockedClient.getTransaction.mockResolvedValue({
      data: { transaction: { state: "FAILED" } },
    });

    const result = await makeProvider().pollTransfer("tx-2");

    expect(result.status).toBe("FAILED");
    expect(result.transactionId).toBe("tx-2");
    expect(result.transactionHash).toBeUndefined();
    expect(result.explorerUrl).toBeUndefined();
  });

  it("throws a normalized error when polling never reaches a terminal state", async () => {
    mockedClient.getTransaction.mockResolvedValue({
      data: { transaction: { state: "SENT" } },
    });

    const error = await makeProvider().pollTransfer("tx-3").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletProviderError);
    expect((error as WalletProviderError).code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("keeps polling across empty transaction responses and times out", async () => {
    mockedClient.getTransaction.mockResolvedValue({});

    const error = await makeProvider().pollTransfer("tx-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletProviderError);
    expect((error as WalletProviderError).code).toBe("PROVIDER_UNAVAILABLE");
    expect(mockedClient.getTransaction).toHaveBeenCalledTimes(3);
  });

  it("does not fabricate an explorer link for a malformed transaction hash", async () => {
    mockedClient.getTransaction.mockResolvedValue({
      data: { transaction: { state: "COMPLETE", txHash: "not-a-real-hash" } },
    });

    const result = await makeProvider().pollTransfer("tx-1");

    expect(result.status).toBe("CONFIRMED");
    expect(result.transactionHash).toBeUndefined();
    expect(result.explorerUrl).toBeUndefined();
  });
});

describe("atomic conversion", () => {
  it("uses six USDC decimals", () => {
    expect(USDC_DECIMALS).toBe(6);
  });
});
