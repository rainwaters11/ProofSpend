import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/health", () => {
  it("returns only safe application health details", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      adapterMode: "mock",
      version: "0.1.0",
    });
  });
});
