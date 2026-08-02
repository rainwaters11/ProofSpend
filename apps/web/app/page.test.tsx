import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Home from "./page";

const originalAdapterMode = process.env.PROOFSPEND_ADAPTER_MODE;

describe("Home", () => {
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

  it("makes mock-only demo behavior unmistakable", () => {
    const markup = renderToStaticMarkup(Home());

    expect(markup).toContain("Fund the vision. Prove the progress. Unlock what comes next.");
    expect(markup).toContain("DEMO MODE");
    expect(markup).toContain("No real funds are being moved.");
    expect(markup).toContain("Adapter: mock");
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
