import { beforeEach, describe, expect, it } from "vitest";

import { parseEnvironment } from "../env";
import {
  AgentApiAccessError,
  authorizeAgentApiRequest,
  authorizeAgentInvocation,
  resetAgentApiAccessForTest,
} from "./access";

const API_TOKEN = "test-agent-api-token-that-is-at-least-32-chars";

function request(args: { key?: string; token?: string } = {}): Request {
  const headers = new Headers();
  if (args.token !== undefined) headers.set("Authorization", `Bearer ${args.token}`);
  if (args.key !== undefined) headers.set("Idempotency-Key", args.key);
  return new Request("http://localhost/api/verification-agent/run", { headers });
}

const openAiEnvironment = parseEnvironment({
  PROOFSPEND_ADAPTER_MODE: "mock",
  PROOFSPEND_AGENT_MODE: "openai",
  PROOFSPEND_AGENT_API_TOKEN: API_TOKEN,
  OPENAI_API_KEY: "test-openai-key",
  LLM_MODEL: "test-model",
});

beforeEach(() => resetAgentApiAccessForTest());

describe("verification agent API access", () => {
  it("binds a valid bearer token to the seeded founder", () => {
    expect(authorizeAgentApiRequest(request({ token: API_TOKEN }), openAiEnvironment)).toBe(
      "founder:fictional",
    );
    expect(() => authorizeAgentApiRequest(request(), openAiEnvironment)).toThrow(
      "AGENT_API_UNAUTHORIZED",
    );
  });

  it("rejects replayed live invocation keys", () => {
    const first = request({ token: API_TOKEN, key: "invocation:unique:0001" });
    expect(authorizeAgentInvocation(first, openAiEnvironment, 1_000)).toBe(
      "founder:fictional",
    );
    expect(() => authorizeAgentInvocation(first, openAiEnvironment, 1_001)).toThrow(
      "AGENT_INVOCATION_REPLAYED",
    );
  });

  it("rate limits paid live invocations", () => {
    for (let index = 0; index < 3; index += 1) {
      authorizeAgentInvocation(
        request({
          token: API_TOKEN,
          key: `invocation:rate:${index.toString().padStart(4, "0")}`,
        }),
        openAiEnvironment,
        1_000,
      );
    }

    try {
      authorizeAgentInvocation(
        request({ token: API_TOKEN, key: "invocation:rate:0004" }),
        openAiEnvironment,
        1_000,
      );
      throw new Error("expected rate limit");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentApiAccessError);
      expect((error as AgentApiAccessError).status).toBe(429);
    }
  });
});
