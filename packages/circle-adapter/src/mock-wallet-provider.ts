import type {
  PaymentPreparation,
  PaymentResult,
  WalletBalance,
  WalletProvider,
  WalletStatus,
} from "./types";

/** A deterministic, credential-free provider that never moves real funds. */
export class MockWalletProvider implements WalletProvider {
  async getStatus(): Promise<WalletStatus> {
    return { mode: "mock", state: "ready" };
  }

  async getBalance(): Promise<WalletBalance> {
    return { asset: "USDC", amountAtomic: "0" };
  }

  async preparePayment(payment: PaymentPreparation): Promise<PaymentPreparation> {
    return { ...payment };
  }

  async executePayment(payment: PaymentPreparation): Promise<PaymentResult> {
    return {
      idempotencyKey: payment.idempotencyKey,
      mode: "mock",
      status: "simulated",
      transactionId: null,
    };
  }
}
