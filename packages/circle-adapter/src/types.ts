export type WalletAdapterMode = "mock" | "circle";

export type WalletStatus = {
  mode: WalletAdapterMode;
  state: "ready" | "unavailable";
};

export type WalletBalance = {
  asset: "USDC";
  amountAtomic: string;
};

export type PaymentPreparation = {
  idempotencyKey: string;
  chain: "ARC-TESTNET";
  asset: "USDC";
  destinationAddress: string;
  amountAtomic: string;
};

export type PaymentResult = {
  idempotencyKey: string;
  mode: WalletAdapterMode;
  status: "simulated" | "pending" | "confirmed" | "failed";
  transactionId: string | null;
};

export interface WalletProvider {
  getStatus(): Promise<WalletStatus>;
  getBalance(): Promise<WalletBalance>;
  preparePayment(payment: PaymentPreparation): Promise<PaymentPreparation>;
  executePayment(payment: PaymentPreparation): Promise<PaymentResult>;
}
