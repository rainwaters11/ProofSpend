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
import { exactIntentIdempotencyKey } from "./exact-intent-idempotency";
import { ActivityEventSchema, HandoffResultSchema } from "./schemas";
import type {
  ActivityEvent,
  ApprovalDecision,
  HandoffResult,
  VerificationAgentResult,
} from "./schemas";
import {
  FileTransferAuthorizationStore,
  type DurableReconciliationRecord,
} from "./durable-authorization-store";

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
  if (run.proposal.idempotencyKey !== exactIntentIdempotencyKey(exactIntentHash)) {
    throw new Error("LIVE_HANDOFF_IDEMPOTENCY_KEY_MISMATCH");
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
      : result.status === "RECOVERY_PENDING"
        ? {
            code: "TRANSACTION_RECOVERY_PENDING" as const,
            message:
              "Circle acceptance is unknown; recovery will look up the exact intent before retrying with the same idempotency key.",
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
  intent: ApprovedTransferIntent,
  transfer: TransferResult,
  activityTrace: ActivityEvent[],
  reconciliation: DurableReconciliationRecord | null,
): HandoffResult {
  const status =
    transfer.status === "CONFIRMED"
      ? "HANDOFF_CONFIRMED"
      : transfer.status === "RECOVERY_PENDING"
        ? "HANDOFF_RECOVERY_PENDING"
      : transfer.status === "SUBMITTED"
        ? "HANDOFF_SUBMITTED"
        : "HANDOFF_FAILED";
  return HandoffResultSchema.parse({
    status,
    adapterMode: "arc-testnet",
    execution: {
      state: transfer.status,
      idempotencyKey: intent.idempotencyKey,
      providerOperationId: transfer.providerOperationId ?? null,
      transactionHash: transfer.transactionHash ?? null,
      confirmation: transfer.status === "CONFIRMED" ? "ARC_TESTNET_CONFIRMED" : null,
      explorerUrl: transfer.explorerUrl ?? null,
      reconciliation:
        reconciliation === null
          ? null
          : {
              state: "RECONCILED",
              reconciliationId: reconciliation.reconciliationId,
              reconciledAt: reconciliation.reconciledAt,
            },
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

function handoffMatchesTerminal(
  intent: ApprovedTransferIntent,
  terminal: TransferResult,
  handoff: HandoffResult | null,
  reconciliation: DurableReconciliationRecord | null,
): boolean {
  const expectedStatus =
    terminal.status === "CONFIRMED" ? "HANDOFF_CONFIRMED" : "HANDOFF_FAILED";
  return (
    handoff?.status === expectedStatus &&
    handoff.execution.state === terminal.status &&
    handoff.execution.idempotencyKey === intent.idempotencyKey &&
    handoff.execution.providerOperationId === (terminal.providerOperationId ?? null) &&
    handoff.execution.transactionHash === (terminal.transactionHash ?? null) &&
    (terminal.status !== "CONFIRMED" ||
      (reconciliation !== null &&
        handoff.execution.reconciliation?.state === "RECONCILED" &&
        handoff.execution.reconciliation.reconciliationId ===
          reconciliation.reconciliationId))
  );
}

type BoundLiveHandoffArgs = {
  runId: string;
  intent: ApprovedTransferIntent;
  authorization: PersistedTransferAuthorization;
  environment: IntegratedLiveEnvironment;
  initialActivityTrace: ActivityEvent[];
  dependencies?: LiveHandoffDependencies;
};

async function executeBoundLiveCircleHandoff(
  args: BoundLiveHandoffArgs,
): Promise<HandoffResult> {
  const store =
    args.dependencies?.store ??
    new FileTransferAuthorizationStore(args.environment.PROOFSPEND_AUTH_STORE_PATH);
  const { intent, authorization } = args;
  const created = await store.persist(authorization);
  const persistedAuthorization = created ? authorization : await store.load(intent);
  if (persistedAuthorization === null) throw new Error("HANDOFF_DUPLICATE");
  const existingResult = created ? null : await store.loadResult(intent.idempotencyKey);
  const trace = structuredClone(args.initialActivityTrace);
  let lastResult: TransferResult | null = null;
  const finish = async (transfer: TransferResult): Promise<HandoffResult> => {
    const boundTransfer = bindResultToIntent(intent, transfer);
    let reconciliation: DurableReconciliationRecord | null = null;
    if (boundTransfer.status === "CONFIRMED") {
      if (
        !boundTransfer.providerOperationId ||
        !boundTransfer.transactionHash ||
        !boundTransfer.blockNumber ||
        !boundTransfer.blockHash ||
        !boundTransfer.explorerUrl
      ) {
        throw new Error("CONFIRMED_TRANSFER_EVIDENCE_INCOMPLETE");
      }
      reconciliation =
        (await store.loadReconciliations(intent.idempotencyKey)).at(-1) ?? null;
      if (reconciliation === null) {
        reconciliation = {
          reconciliationId: `reconciliation:${intent.transactionRecordId}`,
          proposalId: intent.proposalId,
          idempotencyKey: intent.idempotencyKey,
          transactionRecordId: intent.transactionRecordId,
          mode: "ARC_TESTNET",
          status: "RECONCILED",
          network: intent.network,
          chainId: intent.chainId,
          asset: intent.asset,
          amountAtomic: intent.amountAtomic,
          providerOperationId: boundTransfer.providerOperationId,
          transactionHash: boundTransfer.transactionHash,
          blockNumber: boundTransfer.blockNumber,
          blockHash: boundTransfer.blockHash,
          explorerUrl: boundTransfer.explorerUrl,
          reconciledAt: new Date().toISOString(),
        };
        await store.recordReconciliation(reconciliation);
        reconciliation =
          (await store.loadReconciliations(intent.idempotencyKey)).at(-1) ??
          (() => {
            throw new Error("RECONCILIATION_RECORD_MISSING");
          })();
      }
    }
    const result = handoffResult(intent, boundTransfer, trace, reconciliation);
    await store.recordHandoff(result);
    return result;
  };

  const existingHistory = created
    ? []
    : await store.loadResultHistory(intent.idempotencyKey);
  const canRetryPreSubmissionFailure =
    existingResult?.status === "FAILED" &&
    existingResult.providerOperationId === undefined &&
    existingHistory.every((result) => result.providerOperationId === undefined) &&
    persistedAuthorization.binding.status === "ACTIVE";
  const retryClaimToken = canRetryPreSubmissionFailure
    ? await store.claimPreSubmissionRetry(intent)
    : null;
  let retryClaimCompleted = false;

  if (canRetryPreSubmissionFailure && retryClaimToken === null) {
    throw new Error("HANDOFF_DUPLICATE");
  }

  if (
    existingResult?.status === "CONFIRMED" ||
    (existingResult?.status === "FAILED" && !canRetryPreSubmissionFailure)
  ) {
    const reconciliation =
      existingResult.status === "CONFIRMED"
        ? (await store.loadReconciliations(intent.idempotencyKey)).at(-1) ?? null
        : null;
    if (
      handoffMatchesTerminal(
        intent,
        existingResult,
        await store.loadHandoff(intent.idempotencyKey),
        reconciliation,
      )
    ) {
      throw new Error("HANDOFF_DUPLICATE");
    }
    appendTransferEvent(trace, args.runId, existingResult);
    return finish(existingResult);
  }

  const provider =
    args.dependencies?.providerFactory?.({ environment: args.environment, store }) ??
    makeProvider({ environment: args.environment, store });
  try {
    if (!created && existingResult?.status === "SUBMITTED" && existingResult.providerOperationId) {
      lastResult = bindResultToIntent(intent, existingResult);
      appendTransferEvent(trace, args.runId, lastResult);
      const terminal = bindResultToIntent(
        intent,
        await provider.pollTransfer(intent, existingResult.providerOperationId),
      );
      lastResult = terminal;
      appendTransferEvent(trace, args.runId, terminal);
      await store.recordResult(terminal);
      return finish(terminal);
    }

    if (created || canRetryPreSubmissionFailure) {
      const prepared = bindResultToIntent(intent, await provider.prepareTransfer(intent));
      lastResult = prepared;
      appendTransferEvent(trace, args.runId, prepared);
      if (retryClaimToken === null) {
        await store.recordResult(prepared);
      } else {
        await store.completePreSubmissionRetryClaim(retryClaimToken, prepared);
        retryClaimCompleted = true;
      }
      if (prepared.status !== "PREPARED") {
        return finish(prepared);
      }
    }

    const submitted = bindResultToIntent(intent, await provider.submitTransfer(intent));
    lastResult = submitted;
    appendTransferEvent(trace, args.runId, submitted);
    await store.recordResult(submitted);
    if (submitted.status !== "SUBMITTED" || !submitted.providerOperationId) {
      return finish(submitted);
    }

    const terminal = bindResultToIntent(
      intent,
      await provider.pollTransfer(intent, submitted.providerOperationId),
    );
    lastResult = terminal;
    appendTransferEvent(trace, args.runId, terminal);
    await store.recordResult(terminal);
    return finish(terminal);
  } catch (error) {
    const currentAuthorization = await store.load(intent);
    const authorizationConsumed = currentAuthorization?.binding.status === "CONSUMED";
    const submissionAccepted =
      lastResult?.status === "SUBMITTED" && lastResult.providerOperationId !== undefined;
    const submissionUnknown = authorizationConsumed && !submissionAccepted;
    const outcome: TransferResult = {
      proposalId: intent.proposalId,
      idempotencyKey: intent.idempotencyKey,
      mode: "ARC_TESTNET",
      status: submissionAccepted
        ? "SUBMITTED"
        : submissionUnknown
          ? "RECOVERY_PENDING"
          : "FAILED",
      failureCode: submissionAccepted
        ? "POLLING_TIMEOUT"
        : submissionUnknown
          ? "SUBMISSION_UNKNOWN"
          : "AUTHORIZATION_UNAVAILABLE",
      failureMessage: submissionAccepted
        ? "Circle accepted the transfer, but polling needs recovery. Polling resumes with the recorded operation id; no confirmation is claimed."
        : submissionUnknown
          ? "Circle acceptance is unknown. Recovery checks the exact intent before retrying with the same idempotency key; no submission or confirmation is claimed."
          : "The Circle transfer failed closed. No confirmation is claimed.",
      providerOperationId: lastResult?.providerOperationId,
      transactionHash: lastResult?.transactionHash,
      explorerUrl: lastResult?.explorerUrl,
      polledAt: new Date().toISOString(),
    };
    appendTransferEvent(trace, args.runId, outcome);
    if (retryClaimToken !== null && !retryClaimCompleted && lastResult !== null) {
      throw error;
    }
    if (retryClaimToken !== null && !retryClaimCompleted) {
      await store.completePreSubmissionRetryClaim(retryClaimToken, outcome);
      retryClaimCompleted = true;
    } else {
      await store.recordResult(outcome);
    }
    return finish(outcome);
  }
}

function restoreApprovedIntent(
  authorization: PersistedTransferAuthorization,
): ApprovedTransferIntent {
  const executionIntent = authorization.binding.executionIntent;
  const target = executionIntent.protocolTarget;
  if (
    executionIntent.actionKind !== "RELEASE_APPROVAL" ||
    executionIntent.operationType !== "SETTLEMENT" ||
    executionIntent.asset !== "USDC" ||
    target.kind !== "DESTINATION" ||
    target.isMock ||
    target.network !== "ARC_TESTNET" ||
    target.chainId !== ARC_TESTNET_CHAIN_ID ||
    authorization.transaction.releaseRequestId !== authorization.release.id ||
    authorization.transaction.approvalId !== authorization.approval.id ||
    authorization.transaction.approvalBindingId !== authorization.binding.id ||
    authorization.transaction.intentId !== authorization.binding.intentId ||
    authorization.transaction.amount.atomicUnits !== executionIntent.atomicAmount ||
    authorization.transaction.destinationReference.toLowerCase() !==
      target.destination.toLowerCase()
  ) {
    throw new Error("LIVE_HANDOFF_RECOVERY_CONTEXT_INVALID");
  }
  return {
    proposalId: authorization.release.id,
    releaseRequestId: authorization.release.id,
    approvalId: authorization.approval.id,
    authorizationBindingId: authorization.binding.id,
    transactionRecordId: authorization.transaction.id,
    intentId: authorization.binding.intentId,
    idempotencyKey: authorization.transaction.idempotencyKey,
    network: "ARC-TESTNET",
    chainId: ARC_TESTNET_CHAIN_ID,
    asset: "USDC",
    tokenContractAddress: ARC_TESTNET_USDC_ADDRESS,
    amountAtomic: executionIntent.atomicAmount,
    sourceWalletId: target.sourceWalletId,
    destinationAddress: target.destination,
  };
}

function recoveryApprovalMatches(args: {
  authorization: PersistedTransferAuthorization;
  approval: ApprovalDecision;
  authenticatedActorId: string;
  runId: string;
}): boolean {
  const { authorization, approval, authenticatedActorId, runId } = args;
  return (
    authorization.transaction.id === transactionRecordId(runId) &&
    authorization.approval.id === approval.approvalId &&
    authorization.approval.intentId === approval.intentId &&
    authorization.approval.decision === approval.decision &&
    authorization.approval.approver !== null &&
    authorization.approval.approver.actorId === authenticatedActorId &&
    authorization.approval.approver.actorId === approval.authorizedActorId &&
    authorization.approval.approver.actorType === approval.authorizedActorRole &&
    authorization.approval.authorizedActorId === approval.authorizedActorId &&
    authorization.approval.authorizedActorType === approval.authorizedActorRole &&
    authorization.approval.decidedAt === approval.decidedAt &&
    authorization.approval.expiresAt === approval.expiresAt &&
    authorization.approval.idempotencyKey === `approval:${approval.idempotencyKey}` &&
    authorization.approval.exactIntentHash === approval.exactIntentHash &&
    authorization.transaction.idempotencyKey === approval.idempotencyKey &&
    authorization.binding.exactIntentHash === approval.exactIntentHash &&
    authorization.binding.approvalId === approval.approvalId &&
    authorization.release.approvalId === approval.approvalId
  );
}

export async function recoverPersistedLiveCircleHandoff(args: {
  runId: string;
  approval: ApprovalDecision;
  authenticatedActorId: string;
  environment: IntegratedLiveEnvironment;
  dependencies?: LiveHandoffDependencies;
}): Promise<HandoffResult | null> {
  const store =
    args.dependencies?.store ??
    new FileTransferAuthorizationStore(args.environment.PROOFSPEND_AUTH_STORE_PATH);
  const authorization = await store.loadAuthorizationByTransactionRecordId(
    transactionRecordId(args.runId),
  );
  if (authorization === null) {
    return null;
  }
  if (!recoveryApprovalMatches({ ...args, authorization })) {
    throw new Error("HANDOFF_DUPLICATE");
  }
  return executeBoundLiveCircleHandoff({
    runId: args.runId,
    intent: restoreApprovedIntent(authorization),
    authorization,
    environment: args.environment,
    initialActivityTrace: [],
    dependencies: { ...args.dependencies, store },
  });
}

export async function executeLiveCircleHandoff(args: {
  run: VerificationAgentResult;
  approval: ApprovalDecision;
  environment: IntegratedLiveEnvironment;
  initialActivityTrace: ActivityEvent[];
  dependencies?: LiveHandoffDependencies;
}): Promise<HandoffResult> {
  const { intent, authorization } = await buildLiveTransferAuthorization(args);
  return executeBoundLiveCircleHandoff({
    runId: args.run.runId,
    intent,
    authorization,
    environment: args.environment,
    initialActivityTrace: args.initialActivityTrace,
    dependencies: args.dependencies,
  });
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
