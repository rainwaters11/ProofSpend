import { randomUUID } from "node:crypto";

import "server-only";

import {
  applyMissingReceiptRecovery,
  createPawPovAiEvidenceScenario,
  evaluateEvidenceEngine,
  type EvidenceItem,
  type EvidenceMatch,
} from "@proofspend/domain";

import { getEnvironment } from "../env";
import {
  createMockAgentModelProvider,
  createOpenAiAgentModelProvider,
  type AgentModelProvider,
} from "./provider";
import {
  ActivityEventSchema,
  MissingReceiptModelOutputSchema,
  ReleaseProposalSchema,
  SanitizedEvidenceSummarySchema,
  VerificationAgentResultSchema,
  selectSingleMissingReceiptGap,
  type ActivityEvent,
  type VerificationAgentMode,
  type VerificationAgentResult,
} from "./schemas";

const MAX_MODEL_CALLS = 1;
const MAX_ACTIVITY_EVENTS = 10;
const RELEASE_TTL_MS = 15 * 60 * 1000;
const PROPOSAL_INTENT_ID = "intent:release:pawpovai:milestone-launch-ready";
const PROPOSAL_IDEMPOTENCY_KEY = "release:pawpovai:milestone-launch-ready:250usdc";
const PROPOSAL_DESTINATION = "mock:destination:pawpovai-operating-wallet";

function deterministicRequirementOutcomes(
  evaluation: ReturnType<typeof evaluateEvidenceEngine>["evaluation"],
) {
  return evaluation.requirementEvaluations.map((requirement) => ({
    requirementId: requirement.requirementId,
    outcome: requirement.outcome,
    reasonCodes: requirement.reasonCodes,
  }));
}

function buildProvider(mode: VerificationAgentMode): AgentModelProvider {
  const environment = getEnvironment();
  if (mode === "mock") {
    return createMockAgentModelProvider();
  }
  if (environment.PROOFSPEND_AGENT_MODE !== "openai") {
    throw new Error("AGENT_MODE_MISMATCH");
  }
  return createOpenAiAgentModelProvider({
    apiKey: environment.OPENAI_API_KEY,
    model: environment.LLM_MODEL,
  });
}

function buildRunId(now: string): string {
  const compact = now.replaceAll(/[-:TZ.]/g, "");
  return `run:${compact}:${randomUUID()}`;
}

function appendEvent(trace: ActivityEvent[], event: ActivityEvent) {
  trace.push(ActivityEventSchema.parse(event));
}

function redactMessage(message: string): string {
  return message
    .replaceAll(/sha256:[a-f0-9]{64}/g, "[REDACTED_HASH]")
    .replaceAll(/private:\/\/[^\s]+/g, "[REDACTED_EVIDENCE]")
    .replaceAll(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_SECRET]");
}

function buildProposal(reason: string, now: string) {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) {
    throw new Error("AGENT_INVALID_RUN_TIME");
  }
  return ReleaseProposalSchema.parse({
    action: "PREPARE_RELEASE_PROPOSAL",
    state: "APPROVAL_REQUIRED",
    intentId: PROPOSAL_INTENT_ID,
    idempotencyKey: PROPOSAL_IDEMPOTENCY_KEY,
    amount: { asset: "USDC", atomicUnits: "250000000" },
    asset: "USDC",
    chain: "ARC_TESTNET",
    destination: PROPOSAL_DESTINATION,
    authorizedRole: "FOUNDER",
    preparedAt: now,
    expiresAt: new Date(nowMs + RELEASE_TTL_MS).toISOString(),
    reason,
  });
}

export interface RunVerificationAgentOptions {
  now?: string;
  provider?: AgentModelProvider;
  agentMode?: VerificationAgentMode;
}

export async function runVerificationAgent(
  options: RunVerificationAgentOptions = {},
): Promise<VerificationAgentResult> {
  const environment = getEnvironment();
  const now = options.now ?? new Date().toISOString();
  const runId = buildRunId(now);
  const scenario = createPawPovAiEvidenceScenario();
  const provider =
    options.provider ?? buildProvider(options.agentMode ?? environment.PROOFSPEND_AGENT_MODE);
  const trace: ActivityEvent[] = [];
  let modelCallCount = 0;

  appendEvent(trace, {
    id: `${runId}:start`,
    at: now,
    layer: "DETERMINISTIC",
    code: "RUN_STARTED",
    message: "Run started for seeded PawPOVAI verification.",
  });

  const initial = evaluateEvidenceEngine(scenario.initialInput);
  appendEvent(trace, {
    id: `${runId}:evaluate:initial`,
    at: now,
    layer: "DETERMINISTIC",
    code: "MILESTONE_EVALUATED",
    message: `Milestone evaluated with status ${initial.evaluation.status}.`,
  });

  const missingGap = selectSingleMissingReceiptGap(initial.proofGaps);
  appendEvent(trace, {
    id: `${runId}:gap`,
    at: now,
    layer: "DETERMINISTIC",
    code: "PROOF_GAP_FOUND",
    message: "Exactly one missing receipt proof gap was identified.",
  });

  modelCallCount += 1;
  if (modelCallCount > MAX_MODEL_CALLS) {
    throw new Error("AGENT_MAX_TURNS_EXCEEDED");
  }
  const evidenceKindCounts = new Map<string, number>();
  for (const evidence of scenario.initialInput.evidenceItems) {
    evidenceKindCounts.set(
      evidence.kind,
      (evidenceKindCounts.get(evidence.kind) ?? 0) + 1,
    );
  }
  const evidenceSummary = SanitizedEvidenceSummarySchema.parse({
    evidenceItemCount: scenario.initialInput.evidenceItems.length,
    evidenceKinds: Array.from(evidenceKindCounts, ([kind, count]) => ({
      kind,
      count,
    })),
    requirementCount: scenario.initialInput.requirements.length,
  });
  const modelOutput = MissingReceiptModelOutputSchema.parse(
    await provider.analyzeMissingReceipt({
      runId,
      evidenceSummary,
      policyResult: initial.evaluation,
      proofGaps: initial.proofGaps,
    }),
  );

  if (modelOutput.missingGapId !== missingGap.id) {
    throw new Error("AGENT_MODEL_GAP_MISMATCH");
  }

  appendEvent(trace, {
    id: `${runId}:ai`,
    at: now,
    layer: "AI",
    code: "EVIDENCE_ANALYZED",
    message: "AI analyzed the seeded evidence slice and selected one receipt-recovery question.",
  });

  appendEvent(trace, {
    id: `${runId}:question`,
    at: now,
    layer: "AI",
    code: "RECOVERY_QUESTION_ASKED",
    message: redactMessage(modelOutput.question),
  });

  appendEvent(trace, {
    id: `${runId}:correction:required`,
    at: now,
    layer: "HUMAN",
    code: "FOUNDER_CORRECTION_REQUIRED",
    message: "Run paused pending a separately authenticated founder receipt correction.",
  });

  if (trace.length > MAX_ACTIVITY_EVENTS) {
    throw new Error("AGENT_MAX_ACTIVITY_EVENTS_EXCEEDED");
  }

  return VerificationAgentResultSchema.parse({
    runId,
    status: "CORRECTION_REQUIRED",
    agentMode: options.agentMode ?? environment.PROOFSPEND_AGENT_MODE,
    adapterMode: environment.PROOFSPEND_ADAPTER_MODE,
    missingReceiptQuestion: redactMessage(modelOutput.question),
    modelSummary: redactMessage(modelOutput.summary),
    proposal: null,
    missingGapId: missingGap.id,
    recoveryEvidence: null,
    requirementOutcomes: deterministicRequirementOutcomes(initial.evaluation),
    activityTrace: trace.map((event) => ({
      ...event,
      message: redactMessage(event.message),
    })),
  });
}

export function resumeVerificationAgentAfterFounderCorrection(args: {
  run: VerificationAgentResult;
  authenticatedActorId: string;
  receipt: EvidenceItem;
  acceptedMatch: EvidenceMatch;
  now?: string;
}): VerificationAgentResult {
  const run = VerificationAgentResultSchema.parse(args.run);
  if (run.status !== "CORRECTION_REQUIRED" || run.proposal !== null) {
    throw new Error("AGENT_CORRECTION_NOT_REQUIRED");
  }

  const now = args.now ?? new Date().toISOString();
  const scenario = createPawPovAiEvidenceScenario();
  if (scenario.authorizedFounder.actorId !== args.authenticatedActorId) {
    throw new Error("AGENT_FOUNDER_CORRECTION_UNAUTHORIZED");
  }
  const missingGap = selectSingleMissingReceiptGap(
    evaluateEvidenceEngine(scenario.initialInput).proofGaps,
  );
  if (run.missingGapId !== missingGap.id) {
    throw new Error("AGENT_CORRECTION_GAP_MISMATCH");
  }
  const trace = structuredClone(run.activityTrace);
  const recovered = applyMissingReceiptRecovery({
    input: scenario.initialInput,
    gap: missingGap,
    receipt: args.receipt,
    acceptedMatch: args.acceptedMatch,
    actor: scenario.authorizedFounder,
    resolvedAt: now,
  });
  if (recovered.evaluation.status !== "ELIGIBLE") {
    throw new Error("AGENT_CORRECTION_NOT_ELIGIBLE");
  }

  appendEvent(trace, {
    id: `${run.runId}:correction`,
    at: now,
    layer: "HUMAN",
    code: "FOUNDER_CORRECTION_ACCEPTED",
    message: "Founder correction accepted for the missing receipt requirement.",
  });

  appendEvent(trace, {
    id: `${run.runId}:evaluate:recovery`,
    at: now,
    layer: "DETERMINISTIC",
    code: "MILESTONE_REEVALUATED",
    message: `Milestone re-evaluated with status ${recovered.evaluation.status}.`,
  });

  const proposal = buildProposal(
    "Seeded deterministic evaluation passed after one founder receipt correction.",
    now,
  );

  appendEvent(trace, {
    id: `${run.runId}:proposal`,
    at: now,
    layer: "DETERMINISTIC",
    code: "PROPOSAL_PREPARED",
    message: "Prepared exact non-authorizing 250 USDC release proposal.",
  });

  appendEvent(trace, {
    id: `${run.runId}:approval`,
    at: now,
    layer: "HUMAN",
    code: "APPROVAL_REQUIRED",
    message: "Run paused at APPROVAL_REQUIRED for explicit founder approval.",
  });

  if (trace.length > MAX_ACTIVITY_EVENTS) {
    throw new Error("AGENT_MAX_ACTIVITY_EVENTS_EXCEEDED");
  }

  return VerificationAgentResultSchema.parse({
    ...run,
    status: "APPROVAL_REQUIRED",
    proposal,
    recoveryEvidence: {
      gapId: missingGap.id,
      receiptHash: args.receipt.sourceHash,
      acceptedMatchId: args.acceptedMatch.id,
      resolvedAt: now,
    },
    requirementOutcomes: deterministicRequirementOutcomes(recovered.evaluation),
    activityTrace: trace.map((event) => ({
      ...event,
      message: redactMessage(event.message),
    })),
  });
}
