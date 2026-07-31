import { describe, expect, it } from "vitest";

import { MockWalletProvider, normalizeWalletError, WalletProviderError } from "../src";

describe("MockWalletProvider", () => {
  it("reports an explicit credential-free mock status", async () => {
    const provider = new MockWalletProvider();

    await expect(provider.getStatus()).resolves.toEqual({ mode: "mock", state: "ready" });
    await expect(provider.getBalance()).resolves.toEqual({ asset: "USDC", amountAtomic: "0" });
  });

  it("simulates a result without fabricating a transaction identifier", async () => {
    const provider = new MockWalletProvider();
    const preparation = {
      idempotencyKey: "demo-payment-1",
      chain: "ARC-TESTNET" as const,
      asset: "USDC" as const,
      destinationAddress: "0x0000000000000000000000000000000000000001",
      amountAtomic: "1000000",
    };

    await expect(provider.executePayment(preparation)).resolves.toEqual({
      idempotencyKey: "demo-payment-1",
      mode: "mock",
      status: "simulated",
      transactionId: null,
    });
  });
});

describe("normalizeWalletError", () => {
  it("preserves normalized provider errors", () => {
    const error = new WalletProviderError("INVALID_REQUEST", "Invalid payment request.");
    expect(normalizeWalletError(error)).toBe(error);
  });

  it("normalizes unknown failures without leaking their details in the message", () => {
    const error = normalizeWalletError(new Error("sensitive upstream detail"));
    expect(error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(error.message).toBe("Wallet provider request failed.");
  });
});
