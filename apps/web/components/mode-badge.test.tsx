import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ModeBadge } from "./mode-badge";

describe("ModeBadge", () => {
  it("renders visible text for mock mode, not color alone", () => {
    const markup = renderToStaticMarkup(<ModeBadge mode="mock" />);

    expect(markup).toContain("MOCK");
    expect(markup).toContain("Application mode: MOCK");
  });

  it("renders visible text for arc-testnet mode, not color alone", () => {
    const markup = renderToStaticMarkup(<ModeBadge mode="arc-testnet" />);

    expect(markup).toContain("ARC TESTNET");
    expect(markup).toContain("Application mode: ARC TESTNET");
  });

  it("uses distinct text between mock and arc-testnet modes", () => {
    const mockMarkup = renderToStaticMarkup(<ModeBadge mode="mock" />);
    const testnetMarkup = renderToStaticMarkup(<ModeBadge mode="arc-testnet" />);

    expect(mockMarkup).not.toBe(testnetMarkup);
    expect(mockMarkup).toContain("MOCK");
    expect(testnetMarkup).toContain("ARC TESTNET");
  });
});
