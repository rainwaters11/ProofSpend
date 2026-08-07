import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ConfigurationMissingState,
  InsufficientBalanceState,
  OfflineState,
} from "./state-view";

describe("OfflineState", () => {
  it("names the offline condition as an alert, not a generic error", () => {
    const markup = renderToStaticMarkup(<OfflineState />);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("You&#x27;re offline");
    expect(markup).not.toContain("Something went wrong");
  });
});

describe("ConfigurationMissingState", () => {
  it("uses a status role and warning tone, not a destructive/error tone", () => {
    const markup = renderToStaticMarkup(<ConfigurationMissingState />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain("Configuration needed");
    expect(markup).not.toContain("text-destructive");
  });
});

describe("InsufficientBalanceState", () => {
  it("renders available and required amounts without implying funds are available", () => {
    const markup = renderToStaticMarkup(
      <InsufficientBalanceState
        available={{ atomicUnits: "50000000", asset: "USDC" }}
        required={{ atomicUnits: "250000000", asset: "USDC" }}
      />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain("Available: 50.00 USDC");
    expect(markup).toContain("Required: 250.00 USDC");
    expect(markup).toContain("no funds are available to release");
  });
});
