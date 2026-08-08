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
  saveVerificationAgentRun(args);
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
  stored.handoff = {
    approval: ApprovalDecisionSchema.parse(structuredClone(args.approval)),
    result: HandoffResultSchema.parse(structuredClone(args.result)),
  };
  consumedProposalKeys.add(stored.run.proposal.idempotencyKey);
  return true;
}

export function resetVerificationAgentStoreForTest(): void {
  runs.clear();
  consumedProposalKeys.clear();
}
