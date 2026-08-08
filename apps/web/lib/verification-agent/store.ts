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
  handoff: { approval: ApprovalDecision; result: HandoffResult } | null;
  handoffAttempts: Array<{ approval: ApprovalDecision; result: HandoffResult }>;
}

const runs = new Map<string, StoredVerificationRun>();
const consumedProposalKeys = new Set<string>();

export function saveVerificationAgentRun(args: {
  authorizedActorId: string;
  run: VerificationAgentResult;
}): void {
  runs.set(args.run.runId, {
    authorizedActorId: args.authorizedActorId,
    run: VerificationAgentResultSchema.parse(structuredClone(args.run)),
    handoff: null,
    handoffAttempts: [],
  });
}

export function replaceVerificationAgentRun(args: {
  authorizedActorId: string;
  run: VerificationAgentResult;
}): void {
  const stored = runs.get(args.run.runId);
  if (stored === undefined || stored.authorizedActorId !== args.authorizedActorId) {
    throw new Error("VERIFICATION_RUN_NOT_FOUND");
  }
  runs.set(args.run.runId, {
    ...stored,
    run: VerificationAgentResultSchema.parse(structuredClone(args.run)),
  });
}

export function loadVerificationAgentRun(runId: string): StoredVerificationRun | null {
  const stored = runs.get(runId);
  return stored === undefined ? null : structuredClone(stored);
}

export function persistApprovedHandoff(args: {
  runId: string;
  approval: ApprovalDecision;
  result: HandoffResult;
}): boolean {
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
  stored.handoff = handoff;
  stored.handoffAttempts.push(handoff);
  consumedProposalKeys.add(stored.run.proposal.idempotencyKey);
  return true;
}

export function recordRejectedHandoff(args: {
  runId: string;
  approval: ApprovalDecision;
  result: HandoffResult;
}): void {
  const stored = runs.get(args.runId);
  if (stored === undefined) {
    throw new Error("VERIFICATION_RUN_NOT_FOUND");
  }
  stored.handoffAttempts.push(parseHandoffAttempt(args));
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
