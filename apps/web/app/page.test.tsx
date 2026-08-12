import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Home from "./page";

const originalAdapterMode = process.env.PROOFSPEND_ADAPTER_MODE;
const originalAgentMode = process.env.PROOFSPEND_AGENT_MODE;

describe("Home", () => {
  beforeEach(() => {
    process.env.PROOFSPEND_ADAPTER_MODE = "mock";
    process.env.PROOFSPEND_AGENT_MODE = "mock";
  });

  afterEach(() => {
    if (originalAdapterMode === undefined) {
      delete process.env.PROOFSPEND_ADAPTER_MODE;
    } else {
      process.env.PROOFSPEND_ADAPTER_MODE = originalAdapterMode;
    }

    if (originalAgentMode === undefined) {
      delete process.env.PROOFSPEND_AGENT_MODE;
    } else {
      process.env.PROOFSPEND_AGENT_MODE = originalAgentMode;
    }
  });

  it("makes mock-only demo behavior unmistakable", () => {
    const markup = renderToStaticMarkup(Home());

    expect(markup).toContain("Fund the vision. Prove the progress. Unlock what comes next.");
    expect(markup).toContain("DEMO MODE");
    expect(markup).toContain("No real funds are being moved.");
    expect(markup).toContain("Agent: mock");
    expect(markup).toContain("Adapter: mock");
  });


  it("labels explicit Arc Testnet mode truthfully", () => {
    const liveEnvironment = {
      PROOFSPEND_ADAPTER_MODE: "arc-testnet",
      PROOFSPEND_AGENT_MODE: "openai",
      OPENAI_API_KEY: "test-openai-key",
      LLM_MODEL: "gpt-5-mini",
      PROOFSPEND_AGENT_API_TOKEN: "a".repeat(32),
      CIRCLE_API_KEY: "TEST_API_KEY:test:test",
      CIRCLE_ENTITY_SECRET: "a".repeat(64),
      CIRCLE_SOURCE_WALLET_ID: "11111111-1111-4111-8111-111111111111",
      CIRCLE_DESTINATION_WALLET_ID: "22222222-2222-4222-8222-222222222222",
      CIRCLE_DESTINATION_WALLET_ADDRESS:
        "0x1111111111111111111111111111111111111111",
      CIRCLE_CHAIN: "ARC-TESTNET",
      CIRCLE_USDC_TOKEN_ADDRESS: "0x3600000000000000000000000000000000000000",
      CIRCLE_POLL_INTERVAL_MS: "3000",
      CIRCLE_MAX_POLLS: "100",
      CIRCLE_ARGSCAN_BASE_URL: "https://testnet.arcscan.app",
      PROOFSPEND_AUTH_STORE_PATH: "/var/data/proofspend/live-authorization.json",
    } as const;
    const originals = Object.fromEntries(
      Object.keys(liveEnvironment).map((key) => [key, process.env[key]]),
    );

    try {
      Object.assign(process.env, liveEnvironment);
      const markup = renderToStaticMarkup(Home());

      expect(markup).toContain("ARC TESTNET");
      expect(markup).toContain(
        "Test USDC can move only after explicit human approval.",
      );
      expect(markup).not.toContain("No real funds are being moved.");
      expect(markup).toContain("Agent: openai");
      expect(markup).toContain("Adapter: arc-testnet");
    } finally {
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("links directly to the guided demo overview", () => {
    const markup = renderToStaticMarkup(Home());

    expect(markup).toContain('href="/app/overview"');
    expect(markup).toContain("Launch the guided demo");
  });

  it("fails closed when adapter mode is missing", () => {
    delete process.env.PROOFSPEND_ADAPTER_MODE;

    expect(() => renderToStaticMarkup(Home())).toThrow();
  });

  it("scopes legacy landing-page styles to the landing-page class", () => {
    const markup = renderToStaticMarkup(Home());

    expect(markup).toContain('class="landing-page"');
  });
});
