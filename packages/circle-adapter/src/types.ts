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
  transactionHash?: string | null;
  explorerUrl?: string | null;
  terminalState?: string | null;
};

export interface WalletProvider {
  getStatus(): Promise<WalletStatus>;
  getBalance(): Promise<WalletBalance>;
  preparePayment(payment: PaymentPreparation): Promise<PaymentPreparation>;
  executePayment(payment: PaymentPreparation): Promise<PaymentResult>;
}

export const DEMO_TRANSFER_AMOUNT_ATOMIC = "250000000";

export const ARC_TESTNET_CHAIN_ID = "5042002";

export const ARC_TESTNET_USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

export type TransferMode = "ARC_TESTNET" | "MOCK";

export type TransferStatus = "PREPARED" | "SUBMITTED" | "CONFIRMED" | "FAILED";

export type TransferFailureCode =
  | "APPROVAL_MISSING"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_ALTERED"
  | "AMOUNT_MISMATCH"
  | "NETWORK_MISMATCH"
  | "TOKEN_MISMATCH"
  | "WALLET_MISMATCH"
  | "DUPLICATE_SUBMISSION";

export type ApprovedTransferIntent = {
  proposalId: string;
  approvalReference: string;
  exactIntentHash: string;
  idempotencyKey: string;
  network: "ARC-TESTNET";
  chainId: "5042002";
  asset: "USDC";
  tokenContractAddress: string;
  amountAtomic: string;
  sourceWalletId: string;
  destinationAddress: string;
  decidedAt: string;
  expiresAt: string;
};

export type TransferResult = {
  proposalId?: string;
  idempotencyKey?: string;
  mode: TransferMode;
  status: TransferStatus;
  failureCode?: TransferFailureCode;
  failureMessage?: string;
  transactionId?: string;
  transactionHash?: string;
  blockNumber?: number;
  blockHash?: string;
  explorerUrl?: string;
  polledAt?: string;
};

export type TransferWalletStatus = {
  mode: TransferMode;
  state: "ready" | "unavailable";
  sourceWalletId?: string;
  destinationWalletId?: string;
  sourceWalletAddress?: string;
  destinationWalletAddress?: string;
  reason?: string;
};

export interface ArcTestnetTransferProvider {
  getStatus(): Promise<TransferWalletStatus>;
  getBalance(): Promise<WalletBalance>;
  prepareTransfer(intent: ApprovedTransferIntent): Promise<TransferResult>;
  submitTransfer(intent: ApprovedTransferIntent): Promise<TransferResult>;
  pollTransfer(transactionId: string): Promise<TransferResult>;
}
