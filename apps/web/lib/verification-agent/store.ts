import "server-only";

import {
  VerificationAgentResultSchema,
  type VerificationAgentResult,
} from "./schemas";

interface StoredVerificationRun {
  authorizedActorId: string;
  run: VerificationAgentResult;
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
  });
}

export function loadVerificationAgentRun(runId: string): StoredVerificationRun | null {
  const stored = runs.get(runId);
  return stored === undefined ? null : structuredClone(stored);
}

export function consumeProposalIdempotencyKey(key: string): boolean {
  if (consumedProposalKeys.has(key)) {
    return false;
  }
  consumedProposalKeys.add(key);
  return true;
}

export function resetVerificationAgentStoreForTest(): void {
  runs.clear();
  consumedProposalKeys.clear();
}
