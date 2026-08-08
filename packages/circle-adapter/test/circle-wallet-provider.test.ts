import { beforeEach, describe, expect, it, vi } from "vitest";

import { CircleWalletProvider, USDC_DECIMALS } from "../src/circle-wallet-provider";
import { getCircleEnvironment } from "../src/env";
import { WalletProviderError } from "../src/errors";
import type { PaymentPreparation } from "../src/types";

const mockedGetStatus = vi.hoisted(() => ({
  listWallets: vi.fn(),
  getWalletTokenBalance: vi.fn(),
  createTransaction: vi.fn(),
  getTransaction: vi.fn(),
}));

vi.mock("@circle-fin/developer-controlled-wallets", () => ({
  initiateDeveloperControlledWalletsClient: () => mockedGetStatus,
}));

const circleEnvironment = {
  CIRCLE_CHAIN: "ARC-TESTNET",
  CIRCLE_USDC_TOKEN_ADDRESS: "0x3600000000000000000000000000000000000000",
  CIRCLE_POLL_INTERVAL_MS: "1",
  CIRCLE_MAX_POLLS: "3",
  CIRCLE_ARGSCAN_BASE_URL: "https://testnet.arcscan.app",
};

const validPreparation: PaymentPreparation = {
  idempotencyKey: "demo-payment-1",
  chain: "ARC-TESTNET",
  asset: "USDC",
  destinationAddress: "0x0000000000000000000000000000000000000001",
  amountAtomic: "10000",
};

function makeProvider(overrides: Partial<Record<string, unknown>> = {}): CircleWalletProvider {
  return new CircleWalletProvider({
    apiKey: "test-api-key",
    entitySecret: "test-entity-secret",
    sourceWalletId: "wallet-123",
    ...overrides,
  });
}

describe("CircleWalletProvider", () => {
  beforeEach(() => {
    vi.stubEnv("CIRCLE_CHAIN", circleEnvironment.CIRCLE_CHAIN);
    vi.stubEnv("CIRCLE_USDC_TOKEN_ADDRESS", circleEnvironment.CIRCLE_USDC_TOKEN_ADDRESS);
    vi.stubEnv("CIRCLE_POLL_INTERVAL_MS", circleEnvironment.CIRCLE_POLL_INTERVAL_MS);
    vi.stubEnv("CIRCLE_MAX_POLLS", circleEnvironment.CIRCLE_MAX_POLLS);
    vi.stubEnv("CIRCLE_ARGSCAN_BASE_URL", circleEnvironment.CIRCLE_ARGSCAN_BASE_URL);
    mockedGetStatus.listWallets.mockReset();
    mockedGetStatus.getWalletTokenBalance.mockReset();
    mockedGetStatus.createTransaction.mockReset();
    mockedGetStatus.getTransaction.mockReset();
  });

  it("rejects incomplete configuration without touching the network", () => {
    expect(() => new CircleWalletProvider({ apiKey: "", entitySecret: "secret", sourceWalletId: "w" })).toThrow(
      WalletProviderError,
    );
    expect(() => new CircleWalletProvider({ apiKey: "key", entitySecret: "", sourceWalletId: "w" })).toThrow(
      WalletProviderError,
    );
    expect(() => new CircleWalletProvider({ apiKey: "key", entitySecret: "secret", sourceWalletId: "" })).toThrow(
      WalletProviderError,
    );
  });

  it("reports circle mode readiness", async () => {
    mockedGetStatus.listWallets.mockResolvedValue({ data: {} });

    await expect(makeProvider().getStatus()).resolves.toEqual({ mode: "circle", state: "ready" });
  });

  it("reports unavailable when the Circle API cannot be reached", async () => {
    mockedGetStatus.listWallets.mockRejectedValue(new Error("network down"));

    await expect(makeProvider().getStatus()).resolves.toEqual({ mode: "circle", state: "unavailable" });
  });

  it("converts a decimal USDC balance to atomic units", async () => {
    const usdcTokenAddress = getCircleEnvironment().usdcTokenAddress;
    mockedGetStatus.getWalletTokenBalance.mockResolvedValue({
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
    mockedGetStatus.getWalletTokenBalance.mockResolvedValue({ data: { tokenBalances: [] } });

    await expect(makeProvider().getBalance()).resolves.toEqual({
      asset: "USDC",
      amountAtomic: "0",
    });
  });

  it("normalizes a balance failure without leaking details", async () => {
    mockedGetStatus.getWalletTokenBalance.mockRejectedValue(new Error("sensitive upstream detail"));

    const error = await makeProvider().getBalance().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletProviderError);
    expect((error as WalletProviderError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((error as WalletProviderError).message).toBe("Wallet provider request failed.");
  });

  it("passes through a valid payment preparation without touching the network", async () => {
    const provider = makeProvider();

    await expect(provider.preparePayment(validPreparation)).resolves.toEqual(validPreparation);
    expect(mockedGetStatus.createTransaction).not.toHaveBeenCalled();
  });

  it("rejects preparations for an unsupported chain", async () => {
    const payment = { ...validPreparation, chain: "ETHEREUM" } as unknown as PaymentPreparation;

    const error = await makeProvider().preparePayment(payment).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletProviderError);
    expect((error as WalletProviderError).code).toBe("INVALID_REQUEST");
  });

  it("rejects preparations with an invalid destination address", async () => {
    const payment = { ...validPreparation, destinationAddress: "not-an-address" };

    const error = await makeProvider().preparePayment(payment).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletProviderError);
    expect((error as WalletProviderError).code).toBe("INVALID_REQUEST");
  });

  it("rejects preparations with a non-positive amount", async () => {
    const payment = { ...validPreparation, amountAtomic: "0" };

    const error = await makeProvider().preparePayment(payment).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletProviderError);
    expect((error as WalletProviderError).code).toBe("INVALID_REQUEST");
  });

  it("submits a transfer and returns confirmed transaction metadata", async () => {
    const usdcTokenAddress = getCircleEnvironment().usdcTokenAddress;
    const arcscanBaseUrl = getCircleEnvironment().arcscanBaseUrl;
    mockedGetStatus.createTransaction.mockResolvedValue({ data: { id: "tx-1", state: "SENT" } });
    mockedGetStatus.getTransaction.mockResolvedValue({
      data: { transaction: { state: "COMPLETE", txHash: "0xabc123" } },
    });

    const result = await makeProvider().executePayment(validPreparation);

    expect(mockedGetStatus.createTransaction).toHaveBeenCalledWith({
      walletId: "wallet-123",
      tokenAddress: usdcTokenAddress,
      amount: ["0.01"],
      destinationAddress: validPreparation.destinationAddress,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      idempotencyKey: "demo-payment-1",
    });
    expect(mockedGetStatus.getTransaction).toHaveBeenCalledWith({ id: "tx-1" });
    expect(result).toEqual({
      idempotencyKey: "demo-payment-1",
      mode: "circle",
      status: "confirmed",
      transactionId: "tx-1",
      transactionHash: "0xabc123",
      explorerUrl: `${arcscanBaseUrl}/tx/0xabc123`,
      terminalState: "COMPLETE",
    });
  });

  it("returns a failed result for a terminal failure state", async () => {
    mockedGetStatus.createTransaction.mockResolvedValue({ data: { id: "tx-2", state: "SENT" } });
    mockedGetStatus.getTransaction.mockResolvedValue({
      data: { transaction: { state: "FAILED" } },
    });

    const result = await makeProvider().executePayment(validPreparation);

    expect(result.status).toBe("failed");
    expect(result.transactionId).toBe("tx-2");
    expect(result.transactionHash).toBeNull();
    expect(result.explorerUrl).toBeNull();
    expect(result.terminalState).toBe("FAILED");
  });

  it("throws a normalized error when polling never reaches a terminal state", async () => {
    mockedGetStatus.createTransaction.mockResolvedValue({ data: { id: "tx-3", state: "SENT" } });
    mockedGetStatus.getTransaction.mockResolvedValue({
      data: { transaction: { state: "SENT" } },
    });

    const error = await makeProvider().executePayment(validPreparation).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletProviderError);
    expect((error as WalletProviderError).code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("throws a normalized error when the transfer submission fails", async () => {
    mockedGetStatus.createTransaction.mockRejectedValue(new Error("sensitive upstream detail"));

    const error = await makeProvider().executePayment(validPreparation).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletProviderError);
    expect((error as WalletProviderError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((error as WalletProviderError).message).toBe("Wallet provider request failed.");
  });
});

describe("atomic conversion", () => {
  it("uses six USDC decimals", () => {
    expect(USDC_DECIMALS).toBe(6);
  });
});
