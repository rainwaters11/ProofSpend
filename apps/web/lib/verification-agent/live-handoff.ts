import "server-only";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_USDC_ADDRESS,
  CircleWalletProvider,
  type ApprovedTransferIntent,
  type ArcTestnetTransferProvider,
  type PersistedTransferAuthorization,
  type TransferResult,
} from "@proofspend/circle-adapter";
import {
  ApprovalRecordSchema,
  CanonicalExecutionIntentSchema,
  ExecutionAuthorizationBindingSchema,
  ReleaseRequestSchema,
  TransactionRecordSchema,
  createPawPovAiSeed,
  hashCanonicalExecutionIntent,
} from "@proofspend/domain";

import type { ServerEnvironment } from "../env";
import { ActivityEventSchema, HandoffResultSchema } from "./schemas";
import type {
  ActivityEvent,
  ApprovalDecision,
  HandoffResult,
  VerificationAgentResult,
} from "./schemas";
import { FileTransferAuthorizationStore } from "./durable-authorization-store";

const RELEASE_REQUEST_ID = "release:pawpovai:milestone-launch-ready";
const PROOF_ID = "proof:pawpovai:recovered-receipt";

type IntegratedLiveEnvironment = Extract<
  ServerEnvironment,
  { PROOFSPEND_ADAPTER_MODE: "arc-testnet" }
>;

type LiveHandoffDependencies = {
  store?: FileTransferAuthorizationStore;
  providerFactory?: (args: {
    environment: IntegratedLiveEnvironment;
    store: FileTransferAuthorizationStore;
  }) => ArcTestnetTransferProvider;
};

function transactionRecordId(runId: string): string {
  return `transaction:${runId}`;
}

function authorizationBindingId(approvalId: string): string {
  return `binding:${approvalId}`;
}

export async function buildLiveTransferAuthorization(args: {
  run: VerificationAgentResult;
  approval: ApprovalDecision;
  environment: IntegratedLiveEnvironment;
}): Promise<{
  intent: ApprovedTransferIntent;
  authorization: PersistedTransferAuthorization;
}> {
  const { run, approval, environment } = args;
  if (
    run.adapterMode !== "arc-testnet" ||
    run.status !== "APPROVAL_REQUIRED" ||
    run.proposal === null ||
    run.proposal.amount.atomicUnits !== "1000000" ||
    run.proposal.sourceWalletId !== environment.CIRCLE_SOURCE_WALLET_ID ||
    run.proposal.destination.toLowerCase() !==
      environment.CIRCLE_DESTINATION_WALLET_ADDRESS.toLowerCase() ||
    approval.exactIntentHash !== run.proposal.exactIntentHash
  ) {
    throw new Error("LIVE_HANDOFF_PROPOSAL_INVALID");
  }

  const seed = createPawPovAiSeed();
  const transactionId = transactionRecordId(run.runId);
  const bindingId = authorizationBindingId(approval.approvalId);
  const executionIntent = CanonicalExecutionIntentSchema.parse({
    version: 1,
    actionKind: "RELEASE_APPROVAL",
    projectId: seed.project.id,
    releaseRequestId: RELEASE_REQUEST_ID,
    transactionRecordId: transactionId,
    intentId: run.proposal.intentId,
    asset: "USDC",
    atomicAmount: run.proposal.amount.atomicUnits,
    operationType: "SETTLEMENT",
    protocolTarget: {
      kind: "DESTINATION",
      destination: run.proposal.destination,
      sourceWalletId: run.proposal.sourceWalletId,
      network: "ARC_TESTNET",
      chainId: ARC_TESTNET_CHAIN_ID,
      isMock: false,
    },
  });
  const exactIntentHash = await hashCanonicalExecutionIntent(executionIntent);
  if (exactIntentHash !== run.proposal.exactIntentHash) {
    throw new Error("LIVE_HANDOFF_INTENT_HASH_MISMATCH");
  }

  const approvalRecord = ApprovalRecordSchema.parse({
    id: approval.approvalId,
    aggregateId: RELEASE_REQUEST_ID,
    intentId: approval.intentId,
    exactIntentHash,
    idempotencyKey: `approval:${approval.idempotencyKey}`,
    decision: "APPROVED",
    approver: {
      actorId: approval.authorizedActorId,
      actorType: approval.authorizedActorRole,
    },
    expiresAt: approval.expiresAt,
    decidedAt: approval.decidedAt,
    actionKind: "RELEASE_APPROVAL",
    authorizedActorType: approval.authorizedActorRole,
    authorizedActorId: approval.authorizedActorId,
  });
  const release = ReleaseRequestSchema.parse({
    id: RELEASE_REQUEST_ID,
    projectId: seed.project.id,
    milestoneId: seed.milestone.id,
    proofId: PROOF_ID,
    intentId: run.proposal.intentId,
    settlementId: null,
    amount: run.proposal.amount,
    state: "PREPARED",
    approvalId: approval.approvalId,
    idempotencyKey: `release:${approval.idempotencyKey}`,
    createdAt: run.proposal.preparedAt,
  });
  const transaction = TransactionRecordSchema.parse({
    id: transactionId,
    projectId: seed.project.id,
    releaseRequestId: RELEASE_REQUEST_ID,
    intentId: run.proposal.intentId,
    destinationReference: run.proposal.destination,
    approvalId: approval.approvalId,
    approvalBindingId: bindingId,
    reconciliationId: null,
    idempotencyKey: run.proposal.idempotencyKey,
    amount: run.proposal.amount,
    operationState: "PREPARED",
    arcTransaction: {
      network: "ARC_TESTNET",
      chainId: ARC_TESTNET_CHAIN_ID,
      transactionHash: null,
      status: "PREPARED",
      blockNumber: null,
      blockHash: null,
      explorerUrl: null,
      operationType: "SETTLEMENT",
      isMock: false,
    },
    createdAt: run.proposal.preparedAt,
    updatedAt: approval.decidedAt,
  });
  const binding = ExecutionAuthorizationBindingSchema.parse({
    id: bindingId,
    releaseRequestId: RELEASE_REQUEST_ID,
    approvalId: approval.approvalId,
    intentId: run.proposal.intentId,
    exactIntentHash,
    transactionRecordId: transactionId,
    executionIntent,
    status: "ACTIVE",
    consumedAt: null,
    consumedByTransactionId: null,
    createdAt: approval.decidedAt,
  });

  return {
    intent: {
      proposalId: RELEASE_REQUEST_ID,
      releaseRequestId: RELEASE_REQUEST_ID,
      approvalId: approval.approvalId,
      authorizationBindingId: bindingId,
      transactionRecordId: transactionId,
      intentId: run.proposal.intentId,
      idempotencyKey: run.proposal.idempotencyKey,
      network: "ARC-TESTNET",
      chainId: ARC_TESTNET_CHAIN_ID,
      asset: "USDC",
      tokenContractAddress: ARC_TESTNET_USDC_ADDRESS,
      amountAtomic: run.proposal.amount.atomicUnits,
      sourceWalletId: run.proposal.sourceWalletId,
      destinationAddress: run.proposal.destination,
    },
    authorization: { approval: approvalRecord, release, transaction, binding },
  };
}

function makeProvider(args: {
  environment: IntegratedLiveEnvironment;
  store: FileTransferAuthorizationStore;
}): ArcTestnetTransferProvider {
  return new CircleWalletProvider({
    apiKey: args.environment.CIRCLE_API_KEY,
    entitySecret: args.environment.CIRCLE_ENTITY_SECRET,
    sourceWalletId: args.environment.CIRCLE_SOURCE_WALLET_ID,
    destinationWalletId: args.environment.CIRCLE_DESTINATION_WALLET_ID,
    authorizationStore: args.store,
    pollIntervalMs: args.environment.CIRCLE_POLL_INTERVAL_MS,
    maxPolls: args.environment.CIRCLE_MAX_POLLS,
  });
}

function appendTransferEvent(
  trace: ActivityEvent[],
  runId: string,
  result: TransferResult,
): void {
  const at = result.polledAt ?? new Date().toISOString();
  const event =
    result.status === "PREPARED"
      ? {
          code: "TRANSACTION_PREPARED" as const,
          message: "Server prepared the exact approved 1 USDC Arc Testnet transfer.",
        }
      : result.status === "SUBMITTED"
        ? {
            code: "TRANSACTION_SUBMITTED" as const,
            message: "Circle accepted the exact approved transfer for Arc Testnet submission.",
          }
        : result.status === "CONFIRMED"
          ? {
              code: "TRANSACTION_CONFIRMED" as const,
              message: "Arc Testnet confirmed the real 1 USDC transfer.",
            }
          : {
              code: "TRANSACTION_FAILED" as const,
              message: "The Arc Testnet transfer failed closed without being presented as confirmed.",
            };
  trace.push(
    ActivityEventSchema.parse({
      id: `${runId}:handoff:${trace.length}:${result.status.toLowerCase()}`,
      at,
      layer: "ARC TESTNET",
      ...event,
    }),
  );
}

function handoffResult(
  transfer: TransferResult,
  activityTrace: ActivityEvent[],
): HandoffResult {
  const status =
    transfer.status === "CONFIRMED"
      ? "HANDOFF_CONFIRMED"
      : transfer.status === "SUBMITTED"
        ? "HANDOFF_SUBMITTED"
        : "HANDOFF_FAILED";
  return HandoffResultSchema.parse({
    status,
    adapterMode: "arc-testnet",
    execution: {
      state: transfer.status,
      providerOperationId: transfer.providerOperationId ?? null,
      transactionHash: transfer.transactionHash ?? null,
      confirmation: transfer.status === "CONFIRMED" ? "ARC_TESTNET_CONFIRMED" : null,
      explorerUrl: transfer.explorerUrl ?? null,
      failureCode: transfer.failureCode ?? null,
      failureMessage: transfer.failureMessage ?? null,
    },
    activityTrace,
  });
}

function bindResultToIntent(
  intent: ApprovedTransferIntent,
  result: TransferResult,
): TransferResult {
  return {
    ...result,
    proposalId: intent.proposalId,
    idempotencyKey: intent.idempotencyKey,
  };
}

export async function executeLiveCircleHandoff(args: {
  run: VerificationAgentResult;
  approval: ApprovalDecision;
  environment: IntegratedLiveEnvironment;
  initialActivityTrace: ActivityEvent[];
  dependencies?: LiveHandoffDependencies;
}): Promise<HandoffResult> {
  const store =
    args.dependencies?.store ??
    new FileTransferAuthorizationStore(args.environment.PROOFSPEND_AUTH_STORE_PATH);
  const { intent, authorization } = await buildLiveTransferAuthorization(args);
  const created = await store.persist(authorization);
  const persistedAuthorization = created ? authorization : await store.load(intent);
  if (persistedAuthorization === null) throw new Error("HANDOFF_DUPLICATE");
  const existingResult = created ? null : await store.loadResult(intent.idempotencyKey);
  if (existingResult?.status === "CONFIRMED" || existingResult?.status === "FAILED") {
    throw new Error("HANDOFF_DUPLICATE");
  }
  if (
    !created &&
    persistedAuthorization.binding.status !== "CONSUMED"
  ) {
    throw new Error("HANDOFF_DUPLICATE");
  }

  const provider =
    args.dependencies?.providerFactory?.({ environment: args.environment, store }) ??
    makeProvider({ environment: args.environment, store });
  const trace = structuredClone(args.initialActivityTrace);
  let lastResult: TransferResult | null = null;
  const finish = async (transfer: TransferResult): Promise<HandoffResult> => {
    const result = handoffResult(bindResultToIntent(intent, transfer), trace);
    await store.recordHandoff(result);
    return result;
  };
  try {
    if (!created && existingResult?.status === "SUBMITTED" && existingResult.providerOperationId) {
      lastResult = bindResultToIntent(intent, existingResult);
      appendTransferEvent(trace, args.run.runId, lastResult);
      const terminal = bindResultToIntent(
        intent,
        await provider.pollTransfer(intent, existingResult.providerOperationId),
      );
      lastResult = terminal;
      appendTransferEvent(trace, args.run.runId, terminal);
      await store.recordResult(terminal);
      return finish(terminal);
    }

    if (created) {
      const prepared = bindResultToIntent(intent, await provider.prepareTransfer(intent));
      lastResult = prepared;
      appendTransferEvent(trace, args.run.runId, prepared);
      await store.recordResult(prepared);
      if (prepared.status !== "PREPARED") {
        return finish(prepared);
      }
    }

    const submitted = bindResultToIntent(intent, await provider.submitTransfer(intent));
    lastResult = submitted;
    appendTransferEvent(trace, args.run.runId, submitted);
    await store.recordResult(submitted);
    if (submitted.status !== "SUBMITTED" || !submitted.providerOperationId) {
      return finish(submitted);
    }

    const terminal = bindResultToIntent(
      intent,
      await provider.pollTransfer(intent, submitted.providerOperationId),
    );
    lastResult = terminal;
    appendTransferEvent(trace, args.run.runId, terminal);
    await store.recordResult(terminal);
    return finish(terminal);
  } catch {
    const currentAuthorization = await store.load(intent);
    const submissionMayHaveBeenAccepted =
      currentAuthorization?.binding.status === "CONSUMED";
    const outcome: TransferResult = {
      proposalId: intent.proposalId,
      idempotencyKey: intent.idempotencyKey,
      mode: "ARC_TESTNET",
      status: submissionMayHaveBeenAccepted ? "SUBMITTED" : "FAILED",
      failureCode: submissionMayHaveBeenAccepted
        ? "POLLING_TIMEOUT"
        : "AUTHORIZATION_UNAVAILABLE",
      failureMessage: submissionMayHaveBeenAccepted
        ? "Circle submission needs recovery. Retry uses the same idempotency key or resumes polling; no confirmation is claimed."
        : "The Circle transfer failed closed. No confirmation is claimed.",
      providerOperationId: lastResult?.providerOperationId,
      transactionHash: lastResult?.transactionHash,
      explorerUrl: lastResult?.explorerUrl,
      polledAt: new Date().toISOString(),
    };
    appendTransferEvent(trace, args.run.runId, outcome);
    await store.recordResult(outcome);
    return finish(outcome);
  }
}

export async function loadLatestLiveTransferResult(
  environment: ServerEnvironment,
): Promise<TransferResult | null> {
  if (environment.PROOFSPEND_ADAPTER_MODE !== "arc-testnet") {
    return null;
  }
  return new FileTransferAuthorizationStore(
    environment.PROOFSPEND_AUTH_STORE_PATH,
  ).loadLatestResult();
}

export async function loadLatestLiveHandoffResult(
  environment: ServerEnvironment,
): Promise<HandoffResult | null> {
  if (environment.PROOFSPEND_ADAPTER_MODE !== "arc-testnet") {
    return null;
  }
  return new FileTransferAuthorizationStore(
    environment.PROOFSPEND_AUTH_STORE_PATH,
  ).loadLatestHandoff();
}
