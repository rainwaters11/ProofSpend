import { describe, expect, it } from "vitest";

import { parseEnvironment } from "./env";

describe("environment validation", () => {
  it("uses credential-free mock mode when no configuration is supplied", () => {
    expect(parseEnvironment({})).toEqual({
      PROOFSPEND_ADAPTER_MODE: "mock",
    });
  });

  it("treats empty optional credentials as absent in mock mode", () => {
    expect(
      parseEnvironment({
        OPENAI_API_KEY: "",
        LLM_MODEL: "",
        PROOFSPEND_ADAPTER_MODE: "mock",
      }),
    ).toEqual({ PROOFSPEND_ADAPTER_MODE: "mock" });
  });

  it("accepts the documented Arc Testnet configuration", () => {
    expect(
      parseEnvironment({
        CIRCLE_CHAIN: "ARC-TESTNET",
        PROOFSPEND_ADAPTER_MODE: "mock",
      }),
    ).toMatchObject({
      CIRCLE_CHAIN: "ARC-TESTNET",
      PROOFSPEND_ADAPTER_MODE: "mock",
    });
  });

  it("rejects an unsupported adapter mode", () => {
    expect(() =>
      parseEnvironment({ PROOFSPEND_ADAPTER_MODE: "circle" }),
    ).toThrow();
  });
});
