import { SettlementMoneyAmountSchema, type ProofGap } from "@proofspend/domain";
import { z } from "zod";

export const VerificationAgentModeSchema = z.enum(["mock", "openai"]);
export type VerificationAgentMode = z.infer<typeof VerificationAgentModeSchema>;

export const AdapterModeSchema = z.enum(["mock", "arc-testnet"]);
export type AdapterMode = z.infer<typeof AdapterModeSchema>;

export const ActivityLayerSchema = z.enum([
  "AI",
  "DETERMINISTIC",
  "HUMAN",
  "MOCK",
  "ARC TESTNET",
]);
export type ActivityLayer = z.infer<typeof ActivityLayerSchema>;

export const ActivityCodeSchema = z.enum([
  "RUN_STARTED",
  "EVIDENCE_ANALYZED",
  "MILESTONE_EVALUATED",
  "PROOF_GAP_FOUND",
  "RECOVERY_QUESTION_ASKED",
  "FOUNDER_CORRECTION_ACCEPTED",
  "MILESTONE_REEVALUATED",
  "PROPOSAL_PREPARED",
  "APPROVAL_REQUIRED",
  "APPROVAL_ACCEPTED",
  "HANDOFF_REJECTED",
  "HANDOFF_READY",
  "HANDOFF_EXECUTED",
]);

export const ActivityEventSchema = z
  .object({
    id: z.string().min(1),
    at: z.string().datetime(),
    layer: ActivityLayerSchema,
    code: ActivityCodeSchema,
    message: z.string().min(1),
  })
  .strict();
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export const ToolCallSchema = z
  .object({
    name: z.enum([
      "analyze_seeded_evidence",
      "evaluate_milestone",
      "identify_missing_receipt",
      "apply_seeded_founder_correction",
      "re_evaluate_milestone",
      "prepare_release_proposal",
    ]),
    output: z.record(z.string(), z.unknown()),
  })
  .strict();

export const MissingReceiptModelOutputSchema = z
  .object({
    missingGapId: z.string().min(1),
    question: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (value) => /receipt/i.test(value),
        "Recovery question must be focused on the missing receipt.",
      ),
    summary: z.string().min(1).max(500),
    requestedAction: z.literal("ASK_PROOF_RECOVERY_QUESTION"),
  })
  .strict();
export type MissingReceiptModelOutput = z.infer<typeof MissingReceiptModelOutputSchema>;

export const ReleaseProposalSchema = z
  .object({
    action: z.literal("PREPARE_RELEASE_PROPOSAL"),
    state: z.literal("APPROVAL_REQUIRED"),
    intentId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    amount: SettlementMoneyAmountSchema,
    asset: z.literal("USDC"),
    chain: z.literal("ARC_TESTNET"),
    destination: z.string().min(1),
    authorizedRole: z.literal("FOUNDER"),
    expiresAt: z.string().datetime(),
    reason: z.string().min(1),
  })
  .strict();
export type ReleaseProposal = z.infer<typeof ReleaseProposalSchema>;

export const VerificationAgentResultSchema = z
  .object({
    runId: z.string().min(1),
    status: z.literal("APPROVAL_REQUIRED"),
    agentMode: VerificationAgentModeSchema,
    adapterMode: AdapterModeSchema,
    missingReceiptQuestion: z.string().min(1),
    modelSummary: z.string().min(1),
    proposal: ReleaseProposalSchema,
    missingGapId: z.string().min(1),
    activityTrace: z.array(ActivityEventSchema).min(1),
  })
  .strict();
export type VerificationAgentResult = z.infer<typeof VerificationAgentResultSchema>;

export const ApprovalDecisionSchema = z
  .object({
    approvalId: z.string().min(1),
    intentId: z.string().min(1),
    authorizedActorRole: z.literal("FOUNDER"),
    authorizedActorId: z.string().min(1),
    decision: z.literal("APPROVED"),
    decidedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    idempotencyKey: z.string().min(1),
  })
  .strict();
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const HandoffResultSchema = z
  .object({
    status: z.enum(["HANDOFF_REJECTED", "HANDOFF_READY"]),
    adapterMode: AdapterModeSchema,
    execution: z
      .object({
        state: z.enum(["SKIPPED_MOCK", "PENDING_ARC_TESTNET"]),
        transactionHash: z.string().nullable(),
        confirmation: z.string().nullable(),
        explorerUrl: z.string().nullable(),
      })
      .strict(),
    activityTrace: z.array(ActivityEventSchema).min(1),
  })
  .strict();
export type HandoffResult = z.infer<typeof HandoffResultSchema>;

export function selectSingleMissingReceiptGap(proofGaps: readonly ProofGap[]): ProofGap {
  const missingReceiptGaps = proofGaps.filter(
    (gap) => gap.reasonCode === "RECEIPT_EVIDENCE_MISSING" && gap.resolvedAt === null,
  );
  if (missingReceiptGaps.length !== 1) {
    throw new Error("AGENT_EXPECTED_SINGLE_MISSING_RECEIPT_GAP");
  }
  return missingReceiptGaps[0];
}
