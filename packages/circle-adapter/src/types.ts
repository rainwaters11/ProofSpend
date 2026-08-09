import type {
  ApprovalRecord,
  ExecutionAuthorizationBinding,
  ReleaseRequest,
  TransactionRecord,
} from "@proofspend/domain";

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
  | "AUTHORIZATION_UNAVAILABLE"
  | "AMOUNT_MISMATCH"
  | "NETWORK_MISMATCH"
  | "TOKEN_MISMATCH"
  | "WALLET_MISMATCH"
  | "INSUFFICIENT_BALANCE"
  | "DUPLICATE_SUBMISSION"
  | "POLLING_TIMEOUT"
  | "CONFIRMATION_INCOMPLETE";

export type ApprovedTransferIntent = {
  proposalId: string;
  releaseRequestId: string;
  approvalId: string;
  authorizationBindingId: string;
  transactionRecordId: string;
  intentId: string;
  idempotencyKey: string;
  network: "ARC-TESTNET";
  chainId: "5042002";
  asset: "USDC";
  tokenContractAddress: string;
  amountAtomic: string;
  sourceWalletId: string;
  destinationAddress: string;
};

export type TransferAuthorizationReferences = Pick<
  ApprovedTransferIntent,
  | "releaseRequestId"
  | "approvalId"
  | "authorizationBindingId"
  | "transactionRecordId"
  | "intentId"
>;

export type PersistedTransferAuthorization = {
  approval: ApprovalRecord;
  release: ReleaseRequest;
  transaction: TransactionRecord;
  binding: ExecutionAuthorizationBinding;
};

export type ConsumeTransferAuthorizationInput = TransferAuthorizationReferences & {
  expectedExactIntentHash: string;
  idempotencyKey: string;
  asOf: string;
};

/**
 * Server-only durable authorization boundary. `consume` must atomically compare the
 * supplied references/hash/idempotency key against current persisted records, require
 * an active unexpired binding, mark it consumed, and return the exact pre-consumption
 * snapshot. Returning `null` fails closed when the records changed or were consumed.
 */
export interface TransferAuthorizationStore {
  load(references: TransferAuthorizationReferences): Promise<PersistedTransferAuthorization | null>;
  consume(
    input: ConsumeTransferAuthorizationInput,
  ): Promise<PersistedTransferAuthorization | null>;
}

export type TransferResult = {
  proposalId?: string;
  idempotencyKey?: string;
  mode: TransferMode;
  status: TransferStatus;
  failureCode?: TransferFailureCode;
  failureMessage?: string;
  providerOperationId?: string;
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
  pollTransfer(intent: ApprovedTransferIntent, providerOperationId: string): Promise<TransferResult>;
}
