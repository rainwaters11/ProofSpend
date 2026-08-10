import "server-only";

import {
  ActivityEventSchema,
  ApprovalDecisionSchema,
  HandoffResultSchema,
  type ActivityEvent,
  type ApprovalDecision,
  type HandoffResult,
  type VerificationAgentResult,
} from "./schemas";

function appendActivity(trace: ActivityEvent[], event: ActivityEvent) {
  trace.push(ActivityEventSchema.parse(event));
}

export function handoffApprovedProposal(args: {
  run: VerificationAgentResult;
  approval: ApprovalDecision;
  authenticatedActorId: string;
  now?: string;
}): HandoffResult {
  const run = args.run;
  const approval = ApprovalDecisionSchema.parse(args.approval);
  const now = args.now ?? new Date().toISOString();
  const trace: ActivityEvent[] = [];

  if (run.status !== "APPROVAL_REQUIRED" || run.proposal === null) {
    appendActivity(trace, {
      id: `${run.runId}:handoff:reject:state`,
      at: now,
      layer: "DETERMINISTIC",
      code: "HANDOFF_REJECTED",
      message: "Handoff rejected because run is not in APPROVAL_REQUIRED state.",
    });
    return HandoffResultSchema.parse({
      status: "HANDOFF_REJECTED",
      adapterMode: run.adapterMode,
      execution: {
        state: run.adapterMode === "mock" ? "SKIPPED_MOCK" : "NOT_SUBMITTED",
        transactionHash: null,
        confirmation: null,
        explorerUrl: null,
      },
      activityTrace: trace,
    });
  }

  if (
    approval.intentId !== run.proposal.intentId ||
    approval.exactIntentHash !== run.proposal.exactIntentHash
  ) {
    appendActivity(trace, {
      id: `${run.runId}:handoff:reject:intent`,
      at: now,
      layer: "DETERMINISTIC",
      code: "HANDOFF_REJECTED",
      message: "Handoff rejected because approval does not match the exact presented intent.",
    });
    return HandoffResultSchema.parse({
      status: "HANDOFF_REJECTED",
      adapterMode: run.adapterMode,
      execution: {
        state: run.adapterMode === "mock" ? "SKIPPED_MOCK" : "NOT_SUBMITTED",
        transactionHash: null,
        confirmation: null,
        explorerUrl: null,
      },
      activityTrace: trace,
    });
  }

  if (
    approval.authorizedActorId !== args.authenticatedActorId ||
    approval.authorizedActorRole !== run.proposal.authorizedRole
  ) {
    appendActivity(trace, {
      id: `${run.runId}:handoff:reject:actor`,
      at: now,
      layer: "DETERMINISTIC",
      code: "HANDOFF_REJECTED",
      message: "Handoff rejected because the authenticated actor does not own this approval.",
    });
    return HandoffResultSchema.parse({
      status: "HANDOFF_REJECTED",
      adapterMode: run.adapterMode,
      execution: {
        state: run.adapterMode === "mock" ? "SKIPPED_MOCK" : "NOT_SUBMITTED",
        transactionHash: null,
        confirmation: null,
        explorerUrl: null,
      },
      activityTrace: trace,
    });
  }

  const approvalExpiresAt = Date.parse(approval.expiresAt);
  const proposalPreparedAt = Date.parse(run.proposal.preparedAt);
  const proposalExpiresAt = Date.parse(run.proposal.expiresAt);
  const decidedAt = Date.parse(approval.decidedAt);
  const nowMs = Date.parse(now);
  if (
    !Number.isFinite(approvalExpiresAt) ||
    !Number.isFinite(proposalPreparedAt) ||
    !Number.isFinite(proposalExpiresAt) ||
    !Number.isFinite(decidedAt) ||
    !Number.isFinite(nowMs) ||
    decidedAt < proposalPreparedAt ||
    decidedAt > nowMs ||
    decidedAt >= proposalExpiresAt ||
    nowMs >= approvalExpiresAt ||
    nowMs >= proposalExpiresAt ||
    approvalExpiresAt > proposalExpiresAt
  ) {
    appendActivity(trace, {
      id: `${run.runId}:handoff:reject:expiry`,
      at: now,
      layer: "DETERMINISTIC",
      code: "HANDOFF_REJECTED",
      message: "Handoff rejected because approval is stale or expired.",
    });
    return HandoffResultSchema.parse({
      status: "HANDOFF_REJECTED",
      adapterMode: run.adapterMode,
      execution: {
        state: run.adapterMode === "mock" ? "SKIPPED_MOCK" : "NOT_SUBMITTED",
        transactionHash: null,
        confirmation: null,
        explorerUrl: null,
      },
      activityTrace: trace,
    });
  }

  if (approval.idempotencyKey !== run.proposal.idempotencyKey) {
    appendActivity(trace, {
      id: `${run.runId}:handoff:reject:key`,
      at: now,
      layer: "DETERMINISTIC",
      code: "HANDOFF_REJECTED",
      message: "Handoff rejected because the approval does not bind the exact proposal key.",
    });
    return HandoffResultSchema.parse({
      status: "HANDOFF_REJECTED",
      adapterMode: run.adapterMode,
      execution: {
        state: run.adapterMode === "mock" ? "SKIPPED_MOCK" : "NOT_SUBMITTED",
        transactionHash: null,
        confirmation: null,
        explorerUrl: null,
      },
      activityTrace: trace,
    });
  }

  appendActivity(trace, {
    id: `${run.runId}:handoff:approval`,
    at: now,
    layer: "HUMAN",
    code: "APPROVAL_ACCEPTED",
    message: "Human approval accepted after deterministic server revalidation.",
  });

  if (run.adapterMode === "mock") {
    appendActivity(trace, {
      id: `${run.runId}:handoff:mock`,
      at: now,
      layer: "MOCK",
      code: "HANDOFF_EXECUTED",
      message:
        "Mock adapter acknowledged the approved proposal; no Arc transaction hash or confirmation is produced.",
    });
  }

  return HandoffResultSchema.parse({
    status: "HANDOFF_READY",
    adapterMode: run.adapterMode,
    execution: {
      state: run.adapterMode === "mock" ? "SKIPPED_MOCK" : "NOT_SUBMITTED",
      transactionHash: null,
      confirmation: null,
      explorerUrl: null,
    },
    activityTrace: trace,
  });
}
