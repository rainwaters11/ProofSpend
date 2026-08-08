import "server-only";

import {
  applyMissingReceiptRecovery,
  createPawPovAiEvidenceScenario,
  evaluateEvidenceEngine,
} from "@proofspend/domain";

import { getEnvironment } from "../env";
import {
  createMockAgentModelProvider,
  createOpenAiAgentModelProvider,
  type AgentModelProvider,
} from "./provider";
import {
  ActivityEventSchema,
  ReleaseProposalSchema,
  VerificationAgentResultSchema,
  selectSingleMissingReceiptGap,
  type ActivityEvent,
  type VerificationAgentMode,
  type VerificationAgentResult,
} from "./schemas";

const MAX_TURNS = 6;
const RELEASE_EXPIRY = "2026-02-01T00:00:00.000Z";
const PROPOSAL_INTENT_ID = "intent:release:pawpovai:milestone-launch-ready";
const PROPOSAL_IDEMPOTENCY_KEY = "release:pawpovai:milestone-launch-ready:250usdc";
const PROPOSAL_DESTINATION = "mock:destination:pawpovai-operating-wallet";

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
  return `run:${compact}`;
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

function buildProposal(reason: string) {
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
    expiresAt: RELEASE_EXPIRY,
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

  if (trace.length > MAX_TURNS) {
    throw new Error("AGENT_MAX_TURNS_EXCEEDED");
  }

  const modelOutput = await provider.analyzeMissingReceipt({
    runId,
    policyResult: initial.evaluation,
    proofGaps: initial.proofGaps,
  });

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

  const recovered = applyMissingReceiptRecovery({
    input: scenario.initialInput,
    gap: missingGap,
    receipt: scenario.recoveryReceipt,
    acceptedMatch: scenario.recoveryMatch,
    actor: scenario.authorizedFounder,
    resolvedAt: now,
  });

  appendEvent(trace, {
    id: `${runId}:correction`,
    at: now,
    layer: "HUMAN",
    code: "FOUNDER_CORRECTION_ACCEPTED",
    message: "Founder correction accepted for the missing receipt requirement.",
  });

  appendEvent(trace, {
    id: `${runId}:evaluate:recovery`,
    at: now,
    layer: "DETERMINISTIC",
    code: "MILESTONE_REEVALUATED",
    message: `Milestone re-evaluated with status ${recovered.evaluation.status}.`,
  });

  const proposal = buildProposal(
    "Seeded deterministic evaluation passed after one founder receipt correction.",
  );

  appendEvent(trace, {
    id: `${runId}:proposal`,
    at: now,
    layer: "DETERMINISTIC",
    code: "PROPOSAL_PREPARED",
    message: "Prepared exact non-authorizing 250 USDC release proposal.",
  });

  appendEvent(trace, {
    id: `${runId}:approval`,
    at: now,
    layer: "HUMAN",
    code: "APPROVAL_REQUIRED",
    message: "Run paused at APPROVAL_REQUIRED for explicit founder approval.",
  });

  appendEvent(trace, {
    id: `${runId}:adapter`,
    at: now,
    layer:
      environment.PROOFSPEND_ADAPTER_MODE === "mock" ? "MOCK" : "ARC TESTNET",
    code: "HANDOFF_READY",
    message:
      environment.PROOFSPEND_ADAPTER_MODE === "mock"
        ? "Adapter mode is MOCK; execution remains outside the model loop."
        : "Adapter mode is ARC TESTNET; execution remains outside the model loop.",
  });

  const result = VerificationAgentResultSchema.parse({
    runId,
    status: "APPROVAL_REQUIRED",
    agentMode: options.agentMode ?? environment.PROOFSPEND_AGENT_MODE,
    adapterMode: environment.PROOFSPEND_ADAPTER_MODE,
    missingReceiptQuestion: redactMessage(modelOutput.question),
    modelSummary: redactMessage(modelOutput.summary),
    proposal,
    missingGapId: missingGap.id,
    activityTrace: trace.map((event) => ({
      ...event,
      message: redactMessage(event.message),
    })),
  });

  return result;
}
