import "server-only";

import { type MilestoneEvaluationResult, type ProofGap } from "@proofspend/domain";

import { MissingReceiptModelOutputSchema, type MissingReceiptModelOutput } from "./schemas";

export interface AgentModelProvider {
  analyzeMissingReceipt(args: {
    runId: string;
    policyResult: MilestoneEvaluationResult;
    proofGaps: readonly ProofGap[];
  }): Promise<MissingReceiptModelOutput>;
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
  const timeoutMs = config.timeoutMs ?? 15_000;

  return {
    async analyzeMissingReceipt({ policyResult, proofGaps }) {
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
          throw new Error("AGENT_PROVIDER_FAILURE");
        }

        const json = (await response.json()) as {
          output_text?: string;
          output?: Array<{ content?: Array<{ text?: string }> }>;
        };

        const outputText =
          json.output_text ??
          json.output
            ?.flatMap((entry) => entry.content ?? [])
            .find((content) => typeof content.text === "string")?.text;

        if (typeof outputText !== "string") {
          throw new Error("AGENT_INVALID_MODEL_OUTPUT");
        }

        return MissingReceiptModelOutputSchema.parse(JSON.parse(outputText));
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "AGENT_INVALID_MODEL_OUTPUT" ||
            error.message === "AGENT_PROVIDER_FAILURE")
        ) {
          throw error;
        }
        throw new Error("AGENT_PROVIDER_FAILURE");
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
