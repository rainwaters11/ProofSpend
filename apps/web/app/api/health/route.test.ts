import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not report healthy mock mode when adapter mode is absent", () => {
    vi.stubEnv("PROOFSPEND_ADAPTER_MODE", undefined);

    expect(() => GET()).toThrow();
  });

  it("returns only safe application health details", async () => {
    vi.stubEnv("PROOFSPEND_ADAPTER_MODE", "mock");
    const response = GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      adapterMode: "mock",
      version: "0.1.0",
    });
  });
});
