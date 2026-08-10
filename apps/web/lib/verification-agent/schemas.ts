import { SettlementMoneyAmountSchema, type ProofGap } from "@proofspend/domain";
import { z } from "zod";

export const VerificationAgentModeSchema = z.enum(["mock", "openai"]);
export type VerificationAgentMode = z.infer<typeof VerificationAgentModeSchema>;

export const AdapterModeSchema = z.enum(["mock", "arc-testnet"]);
export type AdapterMode = z.infer<typeof AdapterModeSchema>;

export const MAX_HANDOFF_IDENTIFIER_LENGTH = 200;
const BoundedHandoffIdentifierSchema = z.string().min(1).max(MAX_HANDOFF_IDENTIFIER_LENGTH);
const BoundedHandoffTimestampSchema = z.string().max(64).datetime();

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
  "FOUNDER_CORRECTION_REQUIRED",
  "FOUNDER_CORRECTION_ACCEPTED",
  "MILESTONE_REEVALUATED",
  "PROPOSAL_PREPARED",
  "APPROVAL_REQUIRED",
  "APPROVAL_ACCEPTED",
  "HANDOFF_REJECTED",
  "HANDOFF_READY",
  "HANDOFF_EXECUTED",
  "TRANSACTION_PREPARED",
  "TRANSACTION_SUBMITTED",
  "TRANSACTION_CONFIRMED",
  "TRANSACTION_FAILED",
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

export const SanitizedEvidenceSummarySchema = z
  .object({
    evidenceItemCount: z.number().int().nonnegative(),
    evidenceKinds: z.array(
      z
        .object({
          kind: z.enum([
            "RECEIPT",
            "SCREENSHOT",
            "INVOICE",
            "DELIVERABLE",
            "STATEMENT",
            "CONFIRMATION",
          ]),
          count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    requirementCount: z.number().int().nonnegative(),
  })
  .strict();
export type SanitizedEvidenceSummary = z.infer<typeof SanitizedEvidenceSummarySchema>;

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
    sourceWalletId: z.string().min(1),
    exactIntentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    authorizedRole: z.literal("FOUNDER"),
    preparedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    reason: z.string().min(1),
  })
  .strict();
export type ReleaseProposal = z.infer<typeof ReleaseProposalSchema>;

export const RecoveryEvidenceBindingSchema = z
  .object({
    gapId: z.string().min(1),
    receiptHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    acceptedMatchId: z.string().min(1),
    resolvedAt: z.string().datetime(),
  })
  .strict();
export type RecoveryEvidenceBinding = z.infer<typeof RecoveryEvidenceBindingSchema>;

export const DeterministicRequirementOutcomeSchema = z
  .object({
    requirementId: z.string().min(1),
    outcome: z.enum(["PASS", "REVIEW", "FAIL"]),
    reasonCodes: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type DeterministicRequirementOutcome = z.infer<typeof DeterministicRequirementOutcomeSchema>;

export const VerificationAgentResultSchema = z
  .object({
    runId: z.string().min(1),
    status: z.enum(["CORRECTION_REQUIRED", "APPROVAL_REQUIRED"]),
    agentMode: VerificationAgentModeSchema,
    adapterMode: AdapterModeSchema,
    missingReceiptQuestion: z.string().min(1),
    modelSummary: z.string().min(1),
    proposal: ReleaseProposalSchema.nullable(),
    missingGapId: z.string().min(1),
    recoveryEvidence: RecoveryEvidenceBindingSchema.nullable(),
    requirementOutcomes: z.array(DeterministicRequirementOutcomeSchema).min(1),
    activityTrace: z.array(ActivityEventSchema).min(1),
  })
  .strict();
export type VerificationAgentResult = z.infer<typeof VerificationAgentResultSchema>;

export const ApprovalDecisionSchema = z
  .object({
    approvalId: BoundedHandoffIdentifierSchema,
    intentId: BoundedHandoffIdentifierSchema,
    authorizedActorRole: z.literal("FOUNDER"),
    authorizedActorId: BoundedHandoffIdentifierSchema,
    decision: z.literal("APPROVED"),
    decidedAt: BoundedHandoffTimestampSchema,
    expiresAt: BoundedHandoffTimestampSchema,
    idempotencyKey: BoundedHandoffIdentifierSchema,
    exactIntentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const HandoffResultSchema = z
  .object({
    status: z.enum([
      "HANDOFF_REJECTED",
      "HANDOFF_READY",
      "HANDOFF_SUBMITTED",
      "HANDOFF_CONFIRMED",
      "HANDOFF_FAILED",
    ]),
    adapterMode: AdapterModeSchema,
    execution: z
      .object({
        state: z.enum(["NOT_SUBMITTED", "SKIPPED_MOCK", "SUBMITTED", "CONFIRMED", "FAILED"]),
        idempotencyKey: BoundedHandoffIdentifierSchema.optional(),
        providerOperationId: z.string().nullable().optional(),
        transactionHash: z.string().nullable(),
        confirmation: z.string().nullable(),
        explorerUrl: z.string().nullable(),
        reconciliation: z
          .object({
            state: z.literal("RECONCILED"),
            reconciliationId: BoundedHandoffIdentifierSchema,
            reconciledAt: BoundedHandoffTimestampSchema,
          })
          .strict()
          .nullable()
          .optional(),
        failureCode: z.string().nullable().optional(),
        failureMessage: z.string().nullable().optional(),
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
