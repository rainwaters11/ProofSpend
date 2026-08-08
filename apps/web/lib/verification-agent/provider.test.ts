import {
  createPawPovAiEvidenceScenario,
  evaluateEvidenceEngine,
} from "@proofspend/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createOpenAiAgentModelProvider } from "./provider";

afterEach(() => {
  vi.unstubAllGlobals();
});

function createProviderInput() {
  const scenario = createPawPovAiEvidenceScenario();
  const policyResult = evaluateEvidenceEngine(scenario.initialInput);
  return {
    runId: "run:test",
    evidenceSummary: {
      evidenceItemCount: 7,
      evidenceKinds: [
        { kind: "RECEIPT" as const, count: 1 },
        { kind: "DELIVERABLE" as const, count: 3 },
        { kind: "STATEMENT" as const, count: 2 },
        { kind: "CONFIRMATION" as const, count: 1 },
      ],
      requirementCount: 8,
    },
    policyResult: policyResult.evaluation,
    proofGaps: policyResult.proofGaps,
  };
}

describe("createOpenAiAgentModelProvider", () => {
  it("uses one non-stored Responses API call with strict structured output", async () => {
    const input = createProviderInput();
    const missingGap = input.proofGaps.find(
      (gap) => gap.reasonCode === "RECEIPT_EVIDENCE_MISSING",
    );
    expect(missingGap).toBeDefined();

    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body)) as {
        store?: boolean;
        text?: { format?: { type?: string; strict?: boolean } };
        input?: unknown;
      };
      expect(requestBody.store).toBe(false);
      expect(requestBody.text?.format).toMatchObject({
        type: "json_schema",
        strict: true,
      });
      const serializedInput = JSON.stringify(requestBody.input);
      expect(serializedInput).not.toContain("private://");
      expect(serializedInput).not.toContain("sha256:");

      return new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  text: JSON.stringify({
                    missingGapId: missingGap?.id,
                    question: "Please add the missing receipt required for this milestone.",
                    summary: "One receipt is missing from the seeded evidence summary.",
                    requestedAction: "ASK_PROOF_RECOVERY_QUESTION",
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiAgentModelProvider({
      apiKey: "test-key",
      model: "test-model",
    });
    const output = await provider.analyzeMissingReceipt(input);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(output.missingGapId).toBe(missingGap?.id);
  });

  it("fails closed on malformed structured output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ output: [{ content: [{ text: "not-json" }] }] }),
          { status: 200 },
        ),
      ),
    );

    const provider = createOpenAiAgentModelProvider({
      apiKey: "test-key",
      model: "test-model",
    });

    await expect(provider.analyzeMissingReceipt(createProviderInput())).rejects.toThrow(
      "AGENT_INVALID_MODEL_OUTPUT",
    );
  });
});
