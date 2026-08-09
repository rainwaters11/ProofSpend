import { describe, expect, it } from "vitest";

import {
  ARC_TESTNET_ARCSCAN_BASE_URL,
  getCircleEnvironment,
  parseCircleEnvironment,
} from "../src/env";

const validEnvironment = {
  CIRCLE_CHAIN: "ARC-TESTNET",
  CIRCLE_USDC_TOKEN_ADDRESS: "0x3600000000000000000000000000000000000000",
  CIRCLE_POLL_INTERVAL_MS: "3000",
  CIRCLE_MAX_POLLS: "100",
  CIRCLE_ARGSCAN_BASE_URL: "https://testnet.arcscan.app",
};

describe("parseCircleEnvironment", () => {
  it("parses a complete environment into typed configuration", () => {
    expect(parseCircleEnvironment(validEnvironment)).toEqual({
      blockchain: "ARC-TESTNET",
      usdcTokenAddress: validEnvironment.CIRCLE_USDC_TOKEN_ADDRESS,
      pollIntervalMs: 3000,
      maxPolls: 100,
      arcscanBaseUrl: validEnvironment.CIRCLE_ARGSCAN_BASE_URL,
    });
  });

  it("rejects a missing blockchain", () => {
    const { CIRCLE_CHAIN: _, ...incomplete } = validEnvironment;
    expect(() => parseCircleEnvironment(incomplete)).toThrow();
  });

  it("rejects a non-ARC-TESTNET blockchain", () => {
    expect(() =>
      parseCircleEnvironment({ ...validEnvironment, CIRCLE_CHAIN: "ETHEREUM" }),
    ).toThrow();
  });

  it("rejects a malformed token address", () => {
    expect(() =>
      parseCircleEnvironment({ ...validEnvironment, CIRCLE_USDC_TOKEN_ADDRESS: "nope" }),
    ).toThrow();
  });

  it("rejects a syntactically valid address that is not the approved Arc Testnet USDC contract", () => {
    expect(() =>
      parseCircleEnvironment({
        ...validEnvironment,
        CIRCLE_USDC_TOKEN_ADDRESS: "0x1111111111111111111111111111111111111111",
      }),
    ).toThrow();
  });

  it("rejects non-positive polling settings", () => {
    expect(() =>
      parseCircleEnvironment({ ...validEnvironment, CIRCLE_POLL_INTERVAL_MS: "0" }),
    ).toThrow();
    expect(() =>
      parseCircleEnvironment({ ...validEnvironment, CIRCLE_MAX_POLLS: "-5" }),
    ).toThrow();
  });

  it("rejects an invalid explorer URL", () => {
    expect(() =>
      parseCircleEnvironment({ ...validEnvironment, CIRCLE_ARGSCAN_BASE_URL: "not-a-url" }),
    ).toThrow();
  });

  it("rejects a noncanonical explorer URL", () => {
    expect(() =>
      parseCircleEnvironment({
        ...validEnvironment,
        CIRCLE_ARGSCAN_BASE_URL: "https://example.com",
      }),
    ).toThrow();
    expect(ARC_TESTNET_ARCSCAN_BASE_URL).toBe("https://testnet.arcscan.app");
  });
});

describe("getCircleEnvironment", () => {
  it("fails closed when environment variables are absent", () => {
    for (const key of Object.keys(validEnvironment)) {
      delete process.env[key];
    }
    expect(() => getCircleEnvironment()).toThrow();
  });
});
