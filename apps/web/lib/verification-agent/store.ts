import "server-only";

import {
  ApprovalDecisionSchema,
  HandoffResultSchema,
  VerificationAgentResultSchema,
  type ApprovalDecision,
  type HandoffResult,
  type VerificationAgentResult,
} from "./schemas";

interface StoredVerificationRun {
  authorizedActorId: string;
  run: VerificationAgentResult;
  expiresAt: number;
  handoff: { approval: ApprovalDecision; result: HandoffResult } | null;
  handoffReservation: ApprovalDecision | null;
  handoffAttempts: Array<{ approval: ApprovalDecision; result: HandoffResult }>;
}

// Short-lived authenticated run data remains process-local for this bounded demo.
// Live authorization consumption and replay protection use the durable store.
const runs = new Map<string, StoredVerificationRun>();
const consumedProposalKeys = new Set<string>();
const RUN_RETENTION_MS = 30 * 60 * 1000;
const MAX_STORED_RUNS = 100;
export const MAX_HANDOFF_ATTEMPTS_PER_RUN = 20;

function discardExpiredRuns(nowMs = Date.now()): void {
  for (const [runId, stored] of runs) {
    if (stored.expiresAt <= nowMs) {
      runs.delete(runId);
      // Consumed keys intentionally outlive transient run records so expiry
      // cannot reopen an already authorized release for another handoff.
    }
  }
}

export function saveVerificationAgentRun(args: {
  authorizedActorId: string;
  run: VerificationAgentResult;
}): void {
  discardExpiredRuns();
  if (!runs.has(args.run.runId) && runs.size >= MAX_STORED_RUNS) {
    throw new Error("VERIFICATION_RUN_CAPACITY_EXCEEDED");
  }
  runs.set(args.run.runId, {
    authorizedActorId: args.authorizedActorId,
    run: VerificationAgentResultSchema.parse(structuredClone(args.run)),
    expiresAt: Date.now() + RUN_RETENTION_MS,
    handoff: null,
    handoffReservation: null,
    handoffAttempts: [],
  });
}

export function replaceVerificationAgentRun(args: {
  authorizedActorId: string;
  run: VerificationAgentResult;
}): void {
  discardExpiredRuns();
  const stored = runs.get(args.run.runId);
  if (stored === undefined || stored.authorizedActorId !== args.authorizedActorId) {
    throw new Error("VERIFICATION_RUN_NOT_FOUND");
  }
  runs.set(args.run.runId, {
    ...stored,
    run: VerificationAgentResultSchema.parse(structuredClone(args.run)),
    expiresAt: Date.now() + RUN_RETENTION_MS,
  });
}

export function loadVerificationAgentRun(runId: string): StoredVerificationRun | null {
  discardExpiredRuns();
  const stored = runs.get(runId);
  return stored === undefined ? null : structuredClone(stored);
}

export function reserveApprovedHandoff(args: {
  runId: string;
  approval: ApprovalDecision;
}): boolean {
  discardExpiredRuns();
  const stored = runs.get(args.runId);
  if (
    stored === undefined ||
    stored.run.proposal === null ||
    stored.handoffReservation !== null
  ) {
    return false;
  }
  const approval = ApprovalDecisionSchema.parse(structuredClone(args.approval));
  if (stored.handoff !== null) {
    const canRecover =
      ["HANDOFF_SUBMITTED", "HANDOFF_FAILED"].includes(
        stored.handoff.result.status,
      ) &&
      stored.handoff.result.adapterMode === "arc-testnet" &&
      approvalsMatch(stored.handoff.approval, approval);
    if (!canRecover) {
      return false;
    }
  } else if (consumedProposalKeys.has(stored.run.proposal.idempotencyKey)) {
    return false;
  }
  runs.set(args.runId, {
    ...stored,
    handoffReservation: approval,
  });
  return true;
}

export function releaseApprovedHandoffReservation(args: {
  runId: string;
  approval: ApprovalDecision;
}): void {
  discardExpiredRuns();
  const stored = runs.get(args.runId);
  if (
    stored?.handoffReservation === null ||
    stored?.handoffReservation === undefined ||
    !approvalsMatch(stored.handoffReservation, args.approval)
  ) {
    return;
  }
  runs.set(args.runId, {
    ...stored,
    handoffReservation: null,
  });
}

export function persistApprovedHandoff(args: {
  runId: string;
  approval: ApprovalDecision;
  result: HandoffResult;
}): boolean {
  discardExpiredRuns();
  const stored = runs.get(args.runId);
  if (
    stored === undefined ||
    stored.run.proposal === null ||
    stored.handoffReservation === null ||
    !approvalsMatch(stored.handoffReservation, args.approval)
  ) {
    return false;
  }
  const handoff = parseHandoffAttempt(args);
  if (stored.handoff !== null) {
    const isSafeRecovery =
      ["HANDOFF_SUBMITTED", "HANDOFF_FAILED"].includes(
        stored.handoff.result.status,
      ) &&
      stored.handoff.result.adapterMode === "arc-testnet" &&
      handoff.result.adapterMode === "arc-testnet" &&
      ["HANDOFF_SUBMITTED", "HANDOFF_CONFIRMED", "HANDOFF_FAILED"].includes(
        handoff.result.status,
      ) &&
      approvalsMatch(stored.handoff.approval, handoff.approval);
    if (!isSafeRecovery) {
      return false;
    }
    runs.set(args.runId, {
      ...stored,
      handoff,
      handoffReservation: null,
      handoffAttempts: appendHandoffAttempt(stored.handoffAttempts, handoff),
    });
    return true;
  }
  if (consumedProposalKeys.has(stored.run.proposal.idempotencyKey)) {
    return false;
  }
  runs.set(args.runId, {
    ...stored,
    handoff,
    handoffReservation: null,
    handoffAttempts: appendHandoffAttempt(stored.handoffAttempts, handoff),
  });
  consumedProposalKeys.add(stored.run.proposal.idempotencyKey);
  return true;
}

export function approvalsMatch(left: ApprovalDecision, right: ApprovalDecision): boolean {
  return (
    left.approvalId === right.approvalId &&
    left.intentId === right.intentId &&
    left.authorizedActorRole === right.authorizedActorRole &&
    left.authorizedActorId === right.authorizedActorId &&
    left.decision === right.decision &&
    left.decidedAt === right.decidedAt &&
    left.expiresAt === right.expiresAt &&
    left.idempotencyKey === right.idempotencyKey &&
    left.exactIntentHash === right.exactIntentHash
  );
}

export function recordRejectedHandoff(args: {
  runId: string;
  approval: ApprovalDecision;
  result: HandoffResult;
}): void {
  discardExpiredRuns();
  const stored = runs.get(args.runId);
  if (stored === undefined) {
    throw new Error("VERIFICATION_RUN_NOT_FOUND");
  }
  runs.set(args.runId, {
    ...stored,
    handoffAttempts: appendHandoffAttempt(
      stored.handoffAttempts,
      parseHandoffAttempt(args),
    ),
  });
}

function appendHandoffAttempt(
  attempts: StoredVerificationRun["handoffAttempts"],
  attempt: StoredVerificationRun["handoffAttempts"][number],
): StoredVerificationRun["handoffAttempts"] {
  if (attempts.length >= MAX_HANDOFF_ATTEMPTS_PER_RUN) {
    throw new Error("HANDOFF_ATTEMPT_LIMIT_REACHED");
  }
  return [...attempts, attempt];
}

function parseHandoffAttempt(args: {
  approval: ApprovalDecision;
  result: HandoffResult;
}) {
  return {
    approval: ApprovalDecisionSchema.parse(structuredClone(args.approval)),
    result: HandoffResultSchema.parse(structuredClone(args.result)),
  };
}

export function resetVerificationAgentStoreForTest(): void {
  runs.clear();
  consumedProposalKeys.clear();
}
