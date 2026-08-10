import { createHash } from "node:crypto";

import {
  ApprovalRecordSchema,
  CanonicalExecutionIntentSchema,
  ExecutionAuthorizationBindingSchema,
  ReleaseRequestSchema,
  TransactionRecordSchema,
  serializeCanonicalExecutionIntent,
} from "@proofspend/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CircleWalletProvider,
  type CircleWalletProviderConfig,
  USDC_DECIMALS,
} from "../src/circle-wallet-provider";
import { getCircleEnvironment } from "../src/env";
import { WalletProviderError } from "../src/errors";
import type {
  ApprovedTransferIntent,
  ConsumeTransferAuthorizationInput,
  PersistedTransferAuthorization,
  TransferAuthorizationReferences,
  TransferAuthorizationStore,
} from "../src/types";

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

const OPERATION_ID_1 = "11111111-1111-4111-8111-111111111111";
const OPERATION_ID_2 = "22222222-2222-4222-8222-222222222222";
const OPERATION_ID_3 = "33333333-3333-4333-8333-333333333333";
const SOURCE_WALLET_ID = "44444444-4444-4444-8444-444444444444";

const baseIntent: ApprovedTransferIntent = {
  proposalId: "proposal-1",
  releaseRequestId: "proposal-1",
  approvalId: "approval-1",
  authorizationBindingId: "binding-1",
  transactionRecordId: "transaction-record-1",
  intentId: "intent-1",
  idempotencyKey: "demo-payment-1",
  network: "ARC-TESTNET",
  chainId: "5042002",
  asset: "USDC",
  tokenContractAddress: circleEnvironment.CIRCLE_USDC_TOKEN_ADDRESS,
  amountAtomic: "1000000",
  sourceWalletId: SOURCE_WALLET_ID,
  destinationAddress: "0x0000000000000000000000000000000000000001",
};

function validIntent(overrides: Record<string, unknown> = {}): ApprovedTransferIntent {
  return { ...baseIntent, ...overrides } as ApprovedTransferIntent;
}

function createAuthorization(): PersistedTransferAuthorization {
  const executionIntent = CanonicalExecutionIntentSchema.parse({
    version: 1,
    actionKind: "RELEASE_APPROVAL",
    projectId: "project-1",
    releaseRequestId: baseIntent.releaseRequestId,
    transactionRecordId: baseIntent.transactionRecordId,
    intentId: baseIntent.intentId,
    asset: "USDC",
    atomicAmount: baseIntent.amountAtomic,
    operationType: "SETTLEMENT",
    protocolTarget: {
      kind: "DESTINATION",
      isMock: false,
      destination: baseIntent.destinationAddress,
      sourceWalletId: SOURCE_WALLET_ID,
      network: "ARC_TESTNET",
      chainId: "5042002",
    },
  });
  const exactIntentHash = `sha256:${createHash("sha256")
    .update(serializeCanonicalExecutionIntent(executionIntent), "utf8")
    .digest("hex")}`;
  const approval = ApprovalRecordSchema.parse({
    id: baseIntent.approvalId,
    aggregateId: baseIntent.releaseRequestId,
    intentId: baseIntent.intentId,
    exactIntentHash,
    idempotencyKey: "approval-key-1",
    decision: "APPROVED",
    approver: { actorId: "founder-1", actorType: "FOUNDER" },
    expiresAt: "2099-01-01T00:00:00.000Z",
    decidedAt: "2026-08-08T00:00:00.000Z",
    actionKind: "RELEASE_APPROVAL",
    authorizedActorType: "FOUNDER",
    authorizedActorId: "founder-1",
  });
  const release = ReleaseRequestSchema.parse({
    id: baseIntent.releaseRequestId,
    projectId: "project-1",
    milestoneId: "milestone-1",
    proofId: "proof-1",
    intentId: baseIntent.intentId,
    settlementId: null,
    amount: { asset: "USDC", atomicUnits: baseIntent.amountAtomic },
    state: "PREPARED",
    approvalId: baseIntent.approvalId,
    idempotencyKey: "release-key-1",
    createdAt: "2026-08-08T00:00:00.000Z",
  });
  const transaction = TransactionRecordSchema.parse({
    id: baseIntent.transactionRecordId,
    projectId: "project-1",
    releaseRequestId: baseIntent.releaseRequestId,
    intentId: baseIntent.intentId,
    destinationReference: baseIntent.destinationAddress,
    approvalId: baseIntent.approvalId,
    approvalBindingId: baseIntent.authorizationBindingId,
    reconciliationId: null,
    idempotencyKey: baseIntent.idempotencyKey,
    amount: { asset: "USDC", atomicUnits: baseIntent.amountAtomic },
    operationState: "PREPARED",
    arcTransaction: {
      network: "ARC_TESTNET",
      chainId: "5042002",
      transactionHash: null,
      status: "PREPARED",
      blockNumber: null,
      blockHash: null,
      explorerUrl: null,
      operationType: "SETTLEMENT",
      isMock: false,
    },
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  });
  const binding = ExecutionAuthorizationBindingSchema.parse({
    id: baseIntent.authorizationBindingId,
    releaseRequestId: baseIntent.releaseRequestId,
    approvalId: baseIntent.approvalId,
    intentId: baseIntent.intentId,
    exactIntentHash,
    transactionRecordId: baseIntent.transactionRecordId,
    executionIntent,
    status: "ACTIVE",
    consumedAt: null,
    consumedByTransactionId: null,
    createdAt: "2026-08-08T00:00:00.000Z",
  });
  return { approval, release, transaction, binding };
}

class FakeAuthorizationStore implements TransferAuthorizationStore {
  private current: PersistedTransferAuthorization;
  consumeCalls = 0;

  constructor(snapshot: PersistedTransferAuthorization = createAuthorization()) {
    this.current = structuredClone(snapshot);
  }

  async load(references: TransferAuthorizationReferences): Promise<PersistedTransferAuthorization | null> {
    if (
      references.releaseRequestId !== this.current.release.id ||
      references.approvalId !== this.current.approval.id ||
      references.authorizationBindingId !== this.current.binding.id ||
      references.transactionRecordId !== this.current.transaction.id ||
      references.intentId !== this.current.binding.intentId
    ) {
      return null;
    }
    return structuredClone(this.current);
  }

  async consume(
    input: ConsumeTransferAuthorizationInput,
  ): Promise<PersistedTransferAuthorization | null> {
    this.consumeCalls++;
    const snapshot = await this.load(input);
    if (
      snapshot === null ||
      snapshot.binding.status !== "ACTIVE" ||
      snapshot.binding.exactIntentHash !== input.expectedExactIntentHash ||
      snapshot.transaction.idempotencyKey !== input.idempotencyKey ||
      snapshot.approval.decision !== "APPROVED" ||
      Date.parse(snapshot.approval.expiresAt) <= Date.parse(input.asOf)
    ) {
      return null;
    }
    this.current = {
      ...this.current,
      binding: {
        ...this.current.binding,
        status: "CONSUMED",
        consumedAt: input.asOf,
        consumedByTransactionId: input.transactionRecordId,
      },
    };
    return snapshot;
  }

  revoke(): void {
    this.current = {
      ...this.current,
      binding: { ...this.current.binding, status: "REVOKED" },
    };
  }

  markConsumed(): void {
    this.current = {
      ...this.current,
      binding: {
        ...this.current.binding,
        status: "CONSUMED",
        consumedAt: "2026-08-08T00:01:00.000Z",
        consumedByTransactionId: baseIntent.transactionRecordId,
      },
    };
  }
}

function makeProvider(overrides: Partial<CircleWalletProviderConfig> = {}): CircleWalletProvider {
  return new CircleWalletProvider({
    apiKey: "test-api-key",
    entitySecret: "test-entity-secret",
    sourceWalletId: SOURCE_WALLET_ID,
    destinationWalletId: "wallet-dest",
    authorizationStore: new FakeAuthorizationStore(),
    ...overrides,
  });
}

function mockWallets(): void {
  mockedClient.getWallet
    .mockResolvedValueOnce({
      data: { wallet: { id: SOURCE_WALLET_ID, address: "0x0000000000000000000000000000000000000003" } },
    })
    .mockResolvedValueOnce({
      data: { wallet: { id: "wallet-dest", address: baseIntent.destinationAddress } },
    });
}

function mockSufficientBalance(): void {
  mockedClient.getWalletTokenBalance.mockResolvedValue({
    data: {
      tokenBalances: [{
        amount: "1",
        token: { tokenAddress: circleEnvironment.CIRCLE_USDC_TOKEN_ADDRESS },
      }],
    },
  });
}

function mockConfirmedTransaction(overrides: Record<string, unknown> = {}) {
  return {
    state: "COMPLETE",
    txHash: `0x${"1a".repeat(32)}`,
    blockHeight: 42,
    blockHash: `0x${"2b".repeat(32)}`,
    blockchain: "ARC-TESTNET",
    walletId: SOURCE_WALLET_ID,
    destinationAddress: baseIntent.destinationAddress,
    amounts: ["1"],
    contractAddress: circleEnvironment.CIRCLE_USDC_TOKEN_ADDRESS,
    ...overrides,
  };
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
    const authorizationStore = new FakeAuthorizationStore();
    expect(
      () => new CircleWalletProvider({ apiKey: "", entitySecret: "secret", sourceWalletId: "w", destinationWalletId: "d", authorizationStore }),
    ).toThrow(WalletProviderError);
    expect(
      () => new CircleWalletProvider({ apiKey: "key", entitySecret: "", sourceWalletId: "w", destinationWalletId: "d", authorizationStore }),
    ).toThrow(WalletProviderError);
    expect(
      () => new CircleWalletProvider({ apiKey: "key", entitySecret: "secret", sourceWalletId: "", destinationWalletId: "d", authorizationStore }),
    ).toThrow(WalletProviderError);
    expect(
      () => new CircleWalletProvider({ apiKey: "key", entitySecret: "secret", sourceWalletId: "w", destinationWalletId: "", authorizationStore }),
    ).toThrow(WalletProviderError);
  });

  it("reports ready only when both configured Arc wallets resolve", async () => {
    mockedClient.getWallet
      .mockResolvedValueOnce({
        data: { wallet: { id: SOURCE_WALLET_ID, address: "0x0000000000000000000000000000000000000001" } },
      })
      .mockResolvedValueOnce({
        data: { wallet: { id: "wallet-dest", address: "0x0000000000000000000000000000000000000002" } },
      });

    await expect(makeProvider().getStatus()).resolves.toEqual({
      mode: "ARC_TESTNET",
      state: "ready",
      sourceWalletId: SOURCE_WALLET_ID,
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
      sourceWalletId: SOURCE_WALLET_ID,
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
    expect(mockedClient.getWalletTokenBalance).toHaveBeenCalledWith({
      id: SOURCE_WALLET_ID,
      includeAll: true,
      tokenAddresses: [usdcTokenAddress],
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

  it("rejects preparation when the amount is not exactly 1 USDC", async () => {
    const result = await makeProvider().prepareTransfer(
      validIntent({ amountAtomic: "250000000" }),
    );

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("AMOUNT_MISMATCH");
  });

  it("rejects preparation when the intent differs from the approved hash", async () => {
    const result = await makeProvider().prepareTransfer(
      validIntent({ destinationAddress: "0x0000000000000000000000000000000000000002" }),
    );

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("APPROVAL_ALTERED");
  });

  it("rejects preparation when the approval has expired", async () => {
    const authorization = createAuthorization();
    authorization.approval = ApprovalRecordSchema.parse({
      ...authorization.approval,
      expiresAt: "2026-08-08T00:30:00.000Z",
    });
    const result = await makeProvider({
      authorizationStore: new FakeAuthorizationStore(authorization),
    }).prepareTransfer(validIntent());

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
    const result = await makeProvider().prepareTransfer(validIntent({ approvalId: "" }));

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("APPROVAL_MISSING");
  });

  it("submits an approved intent and returns a resumable Circle operation id", async () => {
    const usdcTokenAddress = getCircleEnvironment().usdcTokenAddress;
    mockWallets();
    mockSufficientBalance();
    mockedClient.createTransaction.mockResolvedValue({
      data: { id: OPERATION_ID_1, state: "SENT" },
    });

    const result = await makeProvider().submitTransfer(validIntent());

    expect(mockedClient.createTransaction).toHaveBeenCalledWith({
      walletId: SOURCE_WALLET_ID,
      tokenAddress: usdcTokenAddress,
      amount: ["1"],
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
      providerOperationId: OPERATION_ID_1,
      polledAt: expect.any(String),
    });
  });

  it("recovers an accepted submission by retrying the same Circle idempotency key", async () => {
    const authorizationStore = new FakeAuthorizationStore();
    authorizationStore.markConsumed();
    mockWallets();
    mockedClient.createTransaction.mockResolvedValue({
      data: { id: OPERATION_ID_1, state: "SENT" },
    });

    const result = await makeProvider({ authorizationStore }).submitTransfer(validIntent());

    expect(result).toMatchObject({
      status: "SUBMITTED",
      providerOperationId: OPERATION_ID_1,
      idempotencyKey: baseIntent.idempotencyKey,
    });
    expect(authorizationStore.consumeCalls).toBe(0);
    expect(mockedClient.getWalletTokenBalance).not.toHaveBeenCalled();
    expect(mockedClient.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: baseIntent.idempotencyKey }),
    );
  });

  it("rejects a duplicate submission without touching the network again", async () => {
    mockWallets();
    mockSufficientBalance();
    mockedClient.createTransaction.mockResolvedValue({
      data: { id: OPERATION_ID_1, state: "SENT" },
    });
    const provider = makeProvider();
    const intent = validIntent();

    await provider.submitTransfer(intent);
    const second = await provider.submitTransfer(intent);

    expect(second.status).toBe("FAILED");
    expect(second.failureCode).toBe("DUPLICATE_SUBMISSION");
    expect(mockedClient.createTransaction).toHaveBeenCalledTimes(1);
  });

  it("rejects submission when the destination does not match the configured destination wallet", async () => {
    mockedClient.getWallet.mockResolvedValueOnce({
      data: { wallet: { id: SOURCE_WALLET_ID, address: "0x0000000000000000000000000000000000000003" } },
    });
    mockedClient.getWallet.mockResolvedValueOnce({
      data: { wallet: { id: "wallet-dest", address: "0x0000000000000000000000000000000000000002" } },
    });
    mockSufficientBalance();
    mockedClient.createTransaction.mockResolvedValue({
      data: { id: OPERATION_ID_1, state: "SENT" },
    });

    const result = await makeProvider().submitTransfer(validIntent());

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("WALLET_MISMATCH");
    expect(mockedClient.createTransaction).not.toHaveBeenCalled();
  });

  it("rejects submission when Circle resolves a different source wallet", async () => {
    mockedClient.getWallet
      .mockResolvedValueOnce({
        data: { wallet: { id: "55555555-5555-4555-8555-555555555555" } },
      })
      .mockResolvedValueOnce({
        data: { wallet: { id: "wallet-dest", address: baseIntent.destinationAddress } },
      });
    mockSufficientBalance();

    const result = await makeProvider().submitTransfer(validIntent());

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("WALLET_MISMATCH");
    expect(mockedClient.createTransaction).not.toHaveBeenCalled();
  });

  it("rejects submission without consuming approval when the source USDC balance is insufficient", async () => {
    const authorizationStore = new FakeAuthorizationStore();
    mockWallets();
    mockedClient.getWalletTokenBalance.mockResolvedValue({
      data: {
        tokenBalances: [{
          amount: "0.5",
          token: { tokenAddress: circleEnvironment.CIRCLE_USDC_TOKEN_ADDRESS },
        }],
      },
    });

    const result = await makeProvider({ authorizationStore }).submitTransfer(validIntent());

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("INSUFFICIENT_BALANCE");
    expect(authorizationStore.consumeCalls).toBe(0);
    expect(mockedClient.createTransaction).not.toHaveBeenCalled();
  });

  it("rejects submission when the approved amount changed before submission", async () => {
    mockWallets();
    mockSufficientBalance();

    const result = await makeProvider().submitTransfer(validIntent({ amountAtomic: "250000000" }));

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("AMOUNT_MISMATCH");
    expect(mockedClient.createTransaction).not.toHaveBeenCalled();
  });

  it("fails closed when authorization is revoked during destination lookup", async () => {
    const authorizationStore = new FakeAuthorizationStore();
    mockedClient.getWallet.mockImplementationOnce(async () => ({
      data: { wallet: { id: SOURCE_WALLET_ID, address: "0x0000000000000000000000000000000000000003" } },
    })).mockImplementationOnce(async () => {
      authorizationStore.revoke();
      return {
        data: { wallet: { id: "wallet-dest", address: baseIntent.destinationAddress } },
      };
    });
    mockSufficientBalance();

    const result = await makeProvider({ authorizationStore }).submitTransfer(validIntent());

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("AUTHORIZATION_UNAVAILABLE");
    expect(mockedClient.createTransaction).not.toHaveBeenCalled();
  });

  it("throws a normalized error when the transfer submission fails", async () => {
    mockWallets();
    mockSufficientBalance();
    mockedClient.createTransaction.mockRejectedValue(new Error("sensitive upstream detail"));

    const error = await makeProvider().submitTransfer(validIntent()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletProviderError);
    expect((error as WalletProviderError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((error as WalletProviderError).message).toBe("Wallet provider request failed.");
  });

  it("throws a normalized error when Circle omits the transaction id", async () => {
    mockWallets();
    mockSufficientBalance();
    mockedClient.createTransaction.mockResolvedValue({ data: {} });

    const error = await makeProvider().submitTransfer(validIntent()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletProviderError);
    expect((error as WalletProviderError).code).toBe("INVALID_REQUEST");
    expect((error as WalletProviderError).message).toBe("Circle did not return a transaction id.");
  });

  it("refuses a malformed Circle transaction id instead of recording it", async () => {
    mockWallets();
    mockSufficientBalance();
    mockedClient.createTransaction.mockResolvedValue({
      data: { id: "tx-1", state: "SENT" },
    });

    const error = await makeProvider().submitTransfer(validIntent()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletProviderError);
    expect((error as WalletProviderError).code).toBe("INVALID_REQUEST");
    expect((error as WalletProviderError).message).toContain("malformed transaction id");
  });

  it("refuses to poll a non-UUID provider operation id", async () => {
    const error = await makeProvider()
      .pollTransfer(validIntent(), "tx-1")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WalletProviderError);
    expect((error as WalletProviderError).code).toBe("INVALID_REQUEST");
    expect(mockedClient.getTransaction).not.toHaveBeenCalled();
  });

  it("polls to confirmed and returns real transaction metadata", async () => {
    const arcscanBaseUrl = getCircleEnvironment().arcscanBaseUrl;
    const transactionHash = `0x${"1a".repeat(32)}`;
    const blockHash = `0x${"2b".repeat(32)}`;
    mockedClient.getTransaction.mockResolvedValue({
      data: { transaction: mockConfirmedTransaction() },
    });

    const result = await makeProvider().pollTransfer(validIntent(), OPERATION_ID_1);

    expect(mockedClient.getTransaction).toHaveBeenCalledWith({ id: OPERATION_ID_1 });
    expect(result).toEqual({
      mode: "ARC_TESTNET",
      status: "CONFIRMED",
      providerOperationId: OPERATION_ID_1,
      transactionHash,
      blockHash,
      blockNumber: 42,
      explorerUrl: `${arcscanBaseUrl}/tx/${transactionHash}`,
      polledAt: expect.any(String),
    });
  });

  it("fails confirmation when the confirmed transaction source wallet does not match the intent", async () => {
    mockedClient.getTransaction.mockResolvedValue({
      data: { transaction: mockConfirmedTransaction({ walletId: "wallet-other" }) },
    });

    const result = await makeProvider().pollTransfer(validIntent(), OPERATION_ID_1);

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("WALLET_MISMATCH");
  });

  it("fails confirmation when the confirmed transaction amount does not match the intent", async () => {
    mockedClient.getTransaction.mockResolvedValue({
      data: { transaction: mockConfirmedTransaction({ amounts: ["249"] }) },
    });

    const result = await makeProvider().pollTransfer(validIntent(), OPERATION_ID_1);

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("AMOUNT_MISMATCH");
  });

  it("rejects confirmation when Circle returns the approved amount plus another amount", async () => {
    mockedClient.getTransaction.mockResolvedValue({
      data: { transaction: mockConfirmedTransaction({ amounts: ["1", "250"] }) },
    });

    const result = await makeProvider().pollTransfer(validIntent(), OPERATION_ID_1);

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("AMOUNT_MISMATCH");
  });

  it("fails confirmation when the confirmed transaction destination does not match the intent", async () => {
    mockedClient.getTransaction.mockResolvedValue({
      data: {
        transaction: mockConfirmedTransaction({
          destinationAddress: "0x0000000000000000000000000000000000000002",
        }),
      },
    });

    const result = await makeProvider().pollTransfer(validIntent(), OPERATION_ID_1);

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("WALLET_MISMATCH");
  });

  it("fails confirmation when the confirmed transaction is not on Arc Testnet", async () => {
    mockedClient.getTransaction.mockResolvedValue({
      data: { transaction: mockConfirmedTransaction({ blockchain: "SOL" }) },
    });

    const result = await makeProvider().pollTransfer(validIntent(), OPERATION_ID_1);

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("NETWORK_MISMATCH");
  });

  it("fails confirmation when the confirmed transaction token does not match the intent", async () => {
    mockedClient.getTransaction.mockResolvedValue({
      data: {
        transaction: mockConfirmedTransaction({
          contractAddress: "0x0000000000000000000000000000000000000000",
        }),
      },
    });

    const result = await makeProvider().pollTransfer(validIntent(), OPERATION_ID_1);

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("TOKEN_MISMATCH");
  });

  it("fails closed before polling when the persisted submission cannot be matched to the intent", async () => {
    const nullStore: TransferAuthorizationStore = {
      load: async () => null,
      consume: async () => null,
    };

    const result = await makeProvider({ authorizationStore: nullStore }).pollTransfer(
      validIntent(),
      OPERATION_ID_1,
    );

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("AUTHORIZATION_UNAVAILABLE");
    expect(mockedClient.getTransaction).not.toHaveBeenCalled();
  });

  it("returns a failed poll result for a terminal failure state", async () => {
    mockedClient.getTransaction.mockResolvedValue({
      data: { transaction: { state: "FAILED" } },
    });

    const result = await makeProvider().pollTransfer(validIntent(), OPERATION_ID_2);

    expect(result.status).toBe("FAILED");
    expect(result.providerOperationId).toBe(OPERATION_ID_2);
    expect(result.transactionHash).toBeUndefined();
    expect(result.explorerUrl).toBeUndefined();
  });

  it("returns a resumable submitted result when polling reaches its time limit", async () => {
    mockedClient.getTransaction.mockResolvedValue({
      data: { transaction: { state: "SENT" } },
    });

    const result = await makeProvider().pollTransfer(validIntent(), OPERATION_ID_3);
    expect(result.status).toBe("SUBMITTED");
    expect(result.providerOperationId).toBe(OPERATION_ID_3);
    expect(result.failureCode).toBe("POLLING_TIMEOUT");
  });

  it("keeps polling across empty transaction responses and times out", async () => {
    mockedClient.getTransaction.mockResolvedValue({});

    const result = await makeProvider().pollTransfer(validIntent(), OPERATION_ID_1);
    expect(result.status).toBe("SUBMITTED");
    expect(result.providerOperationId).toBe(OPERATION_ID_1);
    expect(result.failureCode).toBe("POLLING_TIMEOUT");
    expect(mockedClient.getTransaction).toHaveBeenCalledTimes(3);
  });

  it("does not fabricate an explorer link for a malformed transaction hash", async () => {
    mockedClient.getTransaction.mockResolvedValue({
      data: { transaction: { state: "COMPLETE", txHash: "not-a-real-hash" } },
    });

    const result = await makeProvider().pollTransfer(validIntent(), OPERATION_ID_1);

    expect(result.status).toBe("SUBMITTED");
    expect(result.providerOperationId).toBe(OPERATION_ID_1);
    expect(result.failureCode).toBe("CONFIRMATION_INCOMPLETE");
    expect(result.transactionHash).toBeUndefined();
    expect(result.explorerUrl).toBeUndefined();
  });
});

describe("atomic conversion", () => {
  it("uses six USDC decimals", () => {
    expect(USDC_DECIMALS).toBe(6);
  });
});
