import {
  createPawPovAiEvidenceScenario,
  evaluateEvidenceEngine,
} from "@proofspend/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentProviderError,
  createOpenAiAgentModelProvider,
} from "./provider";

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

  it("classifies a provider timeout without retrying", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiAgentModelProvider({
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: 1,
    });

    await expect(provider.analyzeMissingReceipt(createProviderInput())).rejects.toThrow(
      "AGENT_PROVIDER_TIMEOUT",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([400, 401, 429])(
    "classifies upstream HTTP %i and retains only sanitized diagnostics",
    async (status) => {
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              type: "provider_error_type",
              code: "provider_error_code",
              param: "provider_error_param",
              message: "sensitive upstream detail",
            },
            requestBody: "must not be retained",
          }),
          {
            status,
            headers: { "x-request-id": "request-id-123" },
          },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const provider = createOpenAiAgentModelProvider({
        apiKey: "test-key",
        model: "test-model",
      });

      const error = await provider
        .analyzeMissingReceipt(createProviderInput())
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AgentProviderError);
      expect(error).toMatchObject({
        message: `AGENT_PROVIDER_UPSTREAM_${status}`,
        diagnostic: {
          upstreamHttpStatus: status,
          xRequestId: "request-id-123",
          errorType: "provider_error_type",
          errorCode: "provider_error_code",
          errorParam: "provider_error_param",
        },
      });
      expect(error).not.toHaveProperty("diagnostic.message");
      expect(error).not.toHaveProperty("diagnostic.requestBody");
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("classifies a network failure without retrying", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAiAgentModelProvider({
      apiKey: "test-key",
      model: "test-model",
    });

    await expect(provider.analyzeMissingReceipt(createProviderInput())).rejects.toThrow(
      "AGENT_PROVIDER_NETWORK_FAILURE",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
