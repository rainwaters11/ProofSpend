import { describe, expect, it } from "vitest";

import { getAppShellStatus, parseEnvironment } from "./env";

const completeCircleEnvironment = {
  CIRCLE_API_KEY: "TEST_API_KEY:test:key",
  CIRCLE_ENTITY_SECRET: "a".repeat(64),
  CIRCLE_SOURCE_WALLET_ID: "44444444-4444-4444-8444-444444444444",
  CIRCLE_DESTINATION_WALLET_ID: "55555555-5555-4555-8555-555555555555",
  CIRCLE_DESTINATION_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
  CIRCLE_CHAIN: "ARC-TESTNET",
  CIRCLE_USDC_TOKEN_ADDRESS: "0x3600000000000000000000000000000000000000",
  CIRCLE_POLL_INTERVAL_MS: "3000",
  CIRCLE_MAX_POLLS: "100",
  CIRCLE_ARGSCAN_BASE_URL: "https://testnet.arcscan.app",
  PROOFSPEND_AUTH_STORE_PATH: ".proofspend/live-authorization.json",
} as const;

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

  it("ignores unrelated server process variables", () => {
    expect(
      parseEnvironment({
        PATH: "/usr/bin",
        NODE_ENV: "test",
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
        PROOFSPEND_AGENT_API_TOKEN: "test-agent-api-token-that-is-at-least-32-chars",
      }),
    ).toMatchObject({
      PROOFSPEND_ADAPTER_MODE: "mock",
      PROOFSPEND_AGENT_MODE: "openai",
      OPENAI_API_KEY: "sk-test",
      LLM_MODEL: "gpt-5-mini",
      PROOFSPEND_AGENT_API_TOKEN: "test-agent-api-token-that-is-at-least-32-chars",
    });
  });

  it("accepts a complete server-only OpenAI and Arc Testnet configuration", () => {
    expect(
      parseEnvironment({
        OPENAI_API_KEY: "sk-test",
        LLM_MODEL: "gpt-5.1",
        PROOFSPEND_AGENT_API_TOKEN: "test-agent-api-token-that-is-at-least-32-chars",
        PROOFSPEND_ADAPTER_MODE: "arc-testnet",
        PROOFSPEND_AGENT_MODE: "openai",
        CIRCLE_API_KEY: "TEST_API_KEY:test:key",
        CIRCLE_ENTITY_SECRET: "a".repeat(64),
        CIRCLE_SOURCE_WALLET_ID: "44444444-4444-4444-8444-444444444444",
        CIRCLE_DESTINATION_WALLET_ID: "55555555-5555-4555-8555-555555555555",
        CIRCLE_DESTINATION_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
        CIRCLE_CHAIN: "ARC-TESTNET",
        CIRCLE_USDC_TOKEN_ADDRESS: "0x3600000000000000000000000000000000000000",
        CIRCLE_POLL_INTERVAL_MS: "3000",
        CIRCLE_MAX_POLLS: "100",
        CIRCLE_ARGSCAN_BASE_URL: "https://testnet.arcscan.app",
        PROOFSPEND_AUTH_STORE_PATH: ".proofspend/live-authorization.json",
      }),
    ).toMatchObject({
      PROOFSPEND_ADAPTER_MODE: "arc-testnet",
      PROOFSPEND_AGENT_MODE: "openai",
      CIRCLE_POLL_INTERVAL_MS: 3000,
      CIRCLE_MAX_POLLS: 100,
    });
  });

  it("rejects live Arc mode without its durable store and credentials", () => {
    expect(() =>
      parseEnvironment({
        PROOFSPEND_ADAPTER_MODE: "arc-testnet",
        PROOFSPEND_AGENT_MODE: "openai",
      }),
    ).toThrow();
  });
});

describe("app shell environment projection", () => {
  it("preserves mock mode without requiring or exposing Circle configuration", () => {
    expect(
      getAppShellStatus({
        PROOFSPEND_ADAPTER_MODE: "mock",
        CIRCLE_API_KEY: "must-not-be-returned",
      }),
    ).toEqual({ mode: "mock", walletConfigured: false });
  });

  it("reports Arc Testnet and a configured wallet for complete Circle configuration", () => {
    const status = getAppShellStatus({
      PROOFSPEND_ADAPTER_MODE: "arc-testnet",
      ...completeCircleEnvironment,
    });

    expect(status).toEqual({ mode: "arc-testnet", walletConfigured: true });
    expect(JSON.stringify(status)).not.toContain(completeCircleEnvironment.CIRCLE_API_KEY);
    expect(JSON.stringify(status)).not.toContain(completeCircleEnvironment.CIRCLE_ENTITY_SECRET);
    expect(JSON.stringify(status)).not.toContain(completeCircleEnvironment.CIRCLE_SOURCE_WALLET_ID);
  });

  it("keeps Arc Testnet visible but reports the wallet unconfigured during credential-free builds", () => {
    expect(
      getAppShellStatus({ PROOFSPEND_ADAPTER_MODE: "arc-testnet" }),
    ).toEqual({ mode: "arc-testnet", walletConfigured: false });
  });
});
