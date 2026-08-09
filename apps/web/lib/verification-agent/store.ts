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
  handoffAttempts: Array<{ approval: ApprovalDecision; result: HandoffResult }>;
}

// Process-local demo storage. Non-mock handoff remains blocked until Issue #7
// provides durable, atomic persistence shared by all server instances.
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

export function persistApprovedHandoff(args: {
  runId: string;
  approval: ApprovalDecision;
  result: HandoffResult;
}): boolean {
  discardExpiredRuns();
  const stored = runs.get(args.runId);
  if (
    stored === undefined ||
    stored.handoff !== null ||
    stored.run.proposal === null ||
    consumedProposalKeys.has(stored.run.proposal.idempotencyKey)
  ) {
    return false;
  }
  const handoff = parseHandoffAttempt(args);
  runs.set(args.runId, {
    ...stored,
    handoff,
    handoffAttempts: appendHandoffAttempt(stored.handoffAttempts, handoff),
  });
  consumedProposalKeys.add(stored.run.proposal.idempotencyKey);
  return true;
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
