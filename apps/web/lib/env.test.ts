import { describe, expect, it } from "vitest";

import { parseEnvironment } from "./env";

describe("environment validation", () => {
  it("rejects a missing adapter mode", () => {
    expect(() => parseEnvironment({})).toThrow();
  });

  it("accepts explicit credential-free mock mode", () => {
    expect(
      parseEnvironment({
        PROOFSPEND_ADAPTER_MODE: "mock",
        PROOFSPEND_AGENT_MODE: "mock",
      }),
    ).toEqual({
      PROOFSPEND_ADAPTER_MODE: "mock",
      PROOFSPEND_AGENT_MODE: "mock",
    });
  });

  it("treats empty optional credentials as absent in mock mode", () => {
    expect(
      parseEnvironment({
        OPENAI_API_KEY: "",
        LLM_MODEL: "",
        PROOFSPEND_ADAPTER_MODE: "mock",
        PROOFSPEND_AGENT_MODE: "mock",
      }),
    ).toEqual({
      PROOFSPEND_ADAPTER_MODE: "mock",
      PROOFSPEND_AGENT_MODE: "mock",
    });
  });

  it("accepts the documented Arc Testnet configuration", () => {
    expect(
      parseEnvironment({
        CIRCLE_CHAIN: "ARC-TESTNET",
        PROOFSPEND_ADAPTER_MODE: "mock",
        PROOFSPEND_AGENT_MODE: "mock",
      }),
    ).toMatchObject({
      CIRCLE_CHAIN: "ARC-TESTNET",
      PROOFSPEND_ADAPTER_MODE: "mock",
      PROOFSPEND_AGENT_MODE: "mock",
    });
  });

  it("rejects an empty adapter mode", () => {
    expect(() =>
      parseEnvironment({
        PROOFSPEND_ADAPTER_MODE: "",
        PROOFSPEND_AGENT_MODE: "mock",
      }),
    ).toThrow();
  });

  it("rejects an unsupported adapter mode", () => {
    expect(() =>
      parseEnvironment({
        PROOFSPEND_ADAPTER_MODE: "circle",
        PROOFSPEND_AGENT_MODE: "mock",
      }),
    ).toThrow();
  });

  it("rejects an unsupported agent mode", () => {
    expect(() =>
      parseEnvironment({
        PROOFSPEND_ADAPTER_MODE: "mock",
        PROOFSPEND_AGENT_MODE: "auto",
      }),
    ).toThrow();
  });

  it("requires server-side OpenAI configuration in openai mode", () => {
    expect(() =>
      parseEnvironment({
        PROOFSPEND_ADAPTER_MODE: "mock",
        PROOFSPEND_AGENT_MODE: "openai",
      }),
    ).toThrow();
  });

  it("accepts explicit OpenAI mode configuration without fallback", () => {
    expect(
      parseEnvironment({
        PROOFSPEND_ADAPTER_MODE: "mock",
        PROOFSPEND_AGENT_MODE: "openai",
        OPENAI_API_KEY: "sk-test",
        LLM_MODEL: "gpt-5-mini",
      }),
    ).toMatchObject({
      PROOFSPEND_ADAPTER_MODE: "mock",
      PROOFSPEND_AGENT_MODE: "openai",
      OPENAI_API_KEY: "sk-test",
      LLM_MODEL: "gpt-5-mini",
    });
  });
});
