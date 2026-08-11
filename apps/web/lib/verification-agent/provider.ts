import "server-only";

import { type MilestoneEvaluationResult, type ProofGap } from "@proofspend/domain";
import { z } from "zod";

import {
  MissingReceiptModelOutputSchema,
  SanitizedEvidenceSummarySchema,
  type MissingReceiptModelOutput,
  type SanitizedEvidenceSummary,
} from "./schemas";

export interface AgentModelProvider {
  analyzeMissingReceipt(args: {
    runId: string;
    evidenceSummary: SanitizedEvidenceSummary;
    policyResult: MilestoneEvaluationResult;
    proofGaps: readonly ProofGap[];
  }): Promise<MissingReceiptModelOutput>;
}

export interface AgentProviderDiagnostic {
  upstreamHttpStatus: number | null;
  xRequestId: string | null;
  errorType: string | null;
  errorCode: string | null;
  errorParam: string | null;
}

export class AgentProviderError extends Error {
  readonly diagnostic: AgentProviderDiagnostic;

  constructor(code: string, diagnostic: AgentProviderDiagnostic) {
    super(code);
    this.name = "AgentProviderError";
    this.diagnostic = diagnostic;
  }
}

const EMPTY_PROVIDER_DIAGNOSTIC: AgentProviderDiagnostic = {
  upstreamHttpStatus: null,
  xRequestId: null,
  errorType: null,
  errorCode: null,
  errorParam: null,
};

const ProviderDiagnosticIdentifierSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);
const ProviderDiagnosticParamSchema = z
  .string()
  .max(128)
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*(?:(?:\[\d+\])|(?:\.[A-Za-z_][A-Za-z0-9_]*))*$/,
  );
const ProviderRequestIdSchema = z
  .string()
  .max(128)
  .regex(/^req_[A-Za-z0-9]+$/);
const OpenAiResponseEnvelopeSchema = z
  .object({
    output_text: z.string().optional(),
    output: z
      .array(
        z
          .object({
            content: z
              .array(
                z
                  .object({
                    text: z.string().optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

function sanitizedString(schema: z.ZodString, value: unknown): string | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function upstreamFailure(
  response: Response,
  signal: AbortSignal,
): Promise<AgentProviderError> {
  let errorFields: Record<string, unknown> = {};
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "object" && body.error !== null && !Array.isArray(body.error)) {
      errorFields = body.error as Record<string, unknown>;
    }
  } catch (error) {
    if (signal.aborted) throw error;
    // An unreadable upstream error body has no safe diagnostic fields to retain.
  }

  return new AgentProviderError(`AGENT_PROVIDER_UPSTREAM_${response.status}`, {
    upstreamHttpStatus: response.status,
    xRequestId: sanitizedString(
      ProviderRequestIdSchema,
      response.headers.get("x-request-id"),
    ),
    errorType: sanitizedString(ProviderDiagnosticIdentifierSchema, errorFields.type),
    errorCode: sanitizedString(ProviderDiagnosticIdentifierSchema, errorFields.code),
    errorParam: sanitizedString(ProviderDiagnosticParamSchema, errorFields.param),
  });
}

const MOCK_OUTPUT = MissingReceiptModelOutputSchema.parse({
  missingGapId: "proof-gap:milestone:launch-ready:missing-receipt",
  question: "Please add the missing receipt required for this milestone.",
  summary:
    "I found one unresolved receipt gap and need a single founder-provided receipt correction before deterministic re-evaluation.",
  requestedAction: "ASK_PROOF_RECOVERY_QUESTION",
});

export function createMockAgentModelProvider(): AgentModelProvider {
  return {
    async analyzeMissingReceipt() {
      return structuredClone(MOCK_OUTPUT);
    },
  };
}

export function createOpenAiAgentModelProvider(config: {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}): AgentModelProvider {
  const timeoutMs = config.timeoutMs ?? 60_000;

  return {
    async analyzeMissingReceipt({ evidenceSummary, policyResult, proofGaps }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const payload = {
        model: config.model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You are the ProofSpend Verification Agent. Return strict JSON only and request one focused missing-receipt question. Never approve or submit value-moving actions.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  evidenceSummary: SanitizedEvidenceSummarySchema.parse(evidenceSummary),
                  milestoneStatus: policyResult.status,
                  reasonCodes: policyResult.reasonCodes,
                  recommendedNextAction: policyResult.recommendedNextAction,
                  proofGaps: proofGaps.map((gap) => ({
                    id: gap.id,
                    requirementId: gap.requirementId,
                    reasonCode: gap.reasonCode,
                    question: gap.question,
                  })),
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "proofspend_missing_receipt_analysis",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: [
                "missingGapId",
                "question",
                "summary",
                "requestedAction",
              ],
              properties: {
                missingGapId: { type: "string", minLength: 1 },
                question: { type: "string", minLength: 1, maxLength: 200 },
                summary: { type: "string", minLength: 1, maxLength: 500 },
                requestedAction: {
                  type: "string",
                  enum: ["ASK_PROOF_RECOVERY_QUESTION"],
                },
              },
            },
          },
        },
        store: false,
      };

      try {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + config.apiKey,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw await upstreamFailure(response, controller.signal);
        }

        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch (error) {
          if (controller.signal.aborted) throw error;
          throw new AgentProviderError(
            "AGENT_INVALID_MODEL_OUTPUT",
            EMPTY_PROVIDER_DIAGNOSTIC,
          );
        }

        const parsedEnvelope = OpenAiResponseEnvelopeSchema.safeParse(responseBody);
        if (!parsedEnvelope.success) {
          throw new AgentProviderError(
            "AGENT_INVALID_MODEL_OUTPUT",
            EMPTY_PROVIDER_DIAGNOSTIC,
          );
        }

        const outputText =
          parsedEnvelope.data.output_text ??
          parsedEnvelope.data.output
            ?.flatMap((entry) => entry.content ?? [])
            .find((content) => typeof content.text === "string")?.text;

        if (typeof outputText !== "string") {
          throw new AgentProviderError(
            "AGENT_INVALID_MODEL_OUTPUT",
            EMPTY_PROVIDER_DIAGNOSTIC,
          );
        }

        let parsedOutput: unknown;
        try {
          parsedOutput = JSON.parse(outputText);
        } catch {
          throw new AgentProviderError(
            "AGENT_INVALID_MODEL_OUTPUT",
            EMPTY_PROVIDER_DIAGNOSTIC,
          );
        }

        const validatedOutput = MissingReceiptModelOutputSchema.safeParse(parsedOutput);
        if (!validatedOutput.success) {
          throw new AgentProviderError(
            "AGENT_INVALID_MODEL_OUTPUT",
            EMPTY_PROVIDER_DIAGNOSTIC,
          );
        }
        return validatedOutput.data;
      } catch (error) {
        if (error instanceof AgentProviderError) throw error;
        if (controller.signal.aborted) {
          throw new AgentProviderError(
            "AGENT_PROVIDER_TIMEOUT",
            EMPTY_PROVIDER_DIAGNOSTIC,
          );
        }
        throw new AgentProviderError(
          "AGENT_PROVIDER_NETWORK_FAILURE",
          EMPTY_PROVIDER_DIAGNOSTIC,
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
