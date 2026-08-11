import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetAgentApiAccessForTest,
  resetVerificationAgentStoreForTest,
} from "@/lib/verification-agent";

import { POST } from "./route";

const API_TOKEN = "test-agent-api-token-that-is-at-least-32-chars";

const original = {
  PROOFSPEND_ADAPTER_MODE: process.env.PROOFSPEND_ADAPTER_MODE,
  PROOFSPEND_AGENT_MODE: process.env.PROOFSPEND_AGENT_MODE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
  PROOFSPEND_AGENT_API_TOKEN: process.env.PROOFSPEND_AGENT_API_TOKEN,
};

describe("POST /api/verification-agent/run", () => {
  beforeEach(() => {
    process.env.PROOFSPEND_ADAPTER_MODE = "mock";
    process.env.PROOFSPEND_AGENT_MODE = "mock";
    process.env.PROOFSPEND_AGENT_API_TOKEN = API_TOKEN;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_MODEL;
    resetAgentApiAccessForTest();
    resetVerificationAgentStoreForTest();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.PROOFSPEND_ADAPTER_MODE = original.PROOFSPEND_ADAPTER_MODE;
    process.env.PROOFSPEND_AGENT_MODE = original.PROOFSPEND_AGENT_MODE;
    process.env.OPENAI_API_KEY = original.OPENAI_API_KEY;
    process.env.LLM_MODEL = original.LLM_MODEL;
    process.env.PROOFSPEND_AGENT_API_TOKEN = original.PROOFSPEND_AGENT_API_TOKEN;
  });

  it("returns sanitized correction-required run output", async () => {
    const response = await POST(
      new Request("http://localhost/api/verification-agent/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.status).toBe("CORRECTION_REQUIRED");
    expect(json.proposal).toBeNull();
    expect(Array.isArray(json.activityTrace)).toBe(true);
  });

  it("rejects an unauthenticated invocation before running the agent", async () => {
    const response = await POST(
      new Request("http://localhost/api/verification-agent/run", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "AGENT_API_UNAUTHORIZED" });
  });

  it("returns only sanitized provider diagnostics to an authenticated caller", async () => {
    process.env.PROOFSPEND_AGENT_MODE = "openai";
    process.env.OPENAI_API_KEY = "test-openai-api-key";
    process.env.LLM_MODEL = "test-model";

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            type: "invalid_request_error",
            code: "invalid_request",
            param: "text.format.schema",
            message: "sensitive upstream message",
            prompt: "private prompt",
            evidence: "private evidence",
            authorization: "Bearer secret",
            apiKey: "secret-api-key",
            rawOutput: "private raw output",
            environment: "private environment",
          },
          requestBody: "private request body",
        }),
        {
          status: 400,
          headers: { "x-request-id": "request-id-123" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/verification-agent/run", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Idempotency-Key": "route-test:provider-upstream-400",
        },
      }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json).toEqual({
      error: "AGENT_PROVIDER_UPSTREAM_400",
      diagnostic: {
        upstreamHttpStatus: 400,
        xRequestId: "request-id-123",
        errorType: "invalid_request_error",
        errorCode: "invalid_request",
        errorParam: "text.format.schema",
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    const serialized = JSON.stringify(json);
    for (const sensitiveValue of [
      "sensitive upstream message",
      "private prompt",
      "private evidence",
      "Bearer secret",
      "secret-api-key",
      "private raw output",
      "private environment",
      "private request body",
    ]) {
      expect(serialized).not.toContain(sensitiveValue);
    }
  });
});
