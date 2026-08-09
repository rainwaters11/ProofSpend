import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActivityPage from "./page";

const original = {
  PROOFSPEND_ADAPTER_MODE: process.env.PROOFSPEND_ADAPTER_MODE,
  PROOFSPEND_AGENT_MODE: process.env.PROOFSPEND_AGENT_MODE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
};

describe("ActivityPage", () => {
  beforeEach(() => {
    process.env.PROOFSPEND_ADAPTER_MODE = "mock";
    process.env.PROOFSPEND_AGENT_MODE = "mock";
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.PROOFSPEND_ADAPTER_MODE = original.PROOFSPEND_ADAPTER_MODE;
    process.env.PROOFSPEND_AGENT_MODE = original.PROOFSPEND_AGENT_MODE;
    process.env.OPENAI_API_KEY = original.OPENAI_API_KEY;
    process.env.LLM_MODEL = original.LLM_MODEL;
  });

  it("renders ordered, labeled activity for the seeded mock preview", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T12:00:00.000Z"));

    const markup = renderToStaticMarkup(await ActivityPage());

    expect(markup).toContain("Verification Agent Activity");
    expect(markup).toContain("Agent mode:");
    expect(markup).toContain("APPROVAL_REQUIRED");
    expect(markup).toContain("1.00 USDC");
    expect(markup).toContain("AI");
    expect(markup).toContain("DETERMINISTIC");
    expect(markup).toContain("HUMAN");
    expect(markup).toContain("MOCK");
    expect(markup).toContain("including a seeded founder correction");
    expect(markup).toContain("Deterministic requirement outcomes");
    expect(markup).toContain("RECEIPT_COUNT_MET");
    expect(markup).toContain("2026-08-09T12:15:01.000Z");
    expect(markup).not.toContain("2026-01-21T00:16:00.000Z");
  });
});
