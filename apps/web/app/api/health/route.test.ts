import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.stubEnv("PROOFSPEND_ADAPTER_MODE", "mock");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
    vi.unstubAllEnvs();

    expect(() => GET()).toThrow();
  });
});
