import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "./route";

const originalAdapterMode = process.env.PROOFSPEND_ADAPTER_MODE;

describe("GET /api/health", () => {
  beforeEach(() => {
    process.env.PROOFSPEND_ADAPTER_MODE = "mock";
  });

  afterEach(() => {
    if (originalAdapterMode === undefined) {
      delete process.env.PROOFSPEND_ADAPTER_MODE;
    } else {
      process.env.PROOFSPEND_ADAPTER_MODE = originalAdapterMode;
    }
  });

  it("returns only safe application health details", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      adapterMode: "mock",
      version: "0.1.0",
    });
  });

  it("cannot report healthy mock status when adapter mode is missing", () => {
    delete process.env.PROOFSPEND_ADAPTER_MODE;

    expect(() => GET()).toThrow();
  });
});
