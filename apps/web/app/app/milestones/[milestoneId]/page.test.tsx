import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildReleaseScenario } from "@/lib/release-scenario";

import MilestoneDetailPage from "./page";

describe("MilestoneDetailPage", () => {
  const scenario = buildReleaseScenario();

  it("shows the 250 test USDC proposed release amount, not the 150 test USDC spend limit", async () => {
    const markup = renderToStaticMarkup(
      await MilestoneDetailPage({
        params: Promise.resolve({ milestoneId: scenario.milestone.id }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(markup).toContain("250.00 USDC");
    expect(markup).toContain("150 test USDC eligible-spend limit");
  });

  it("keeps the release purpose free of outcome language for unevaluated evidence", async () => {
    const markup = renderToStaticMarkup(
      await MilestoneDetailPage({
        params: Promise.resolve({ milestoneId: scenario.milestone.id }),
        searchParams: Promise.resolve({}),
      }),
    );

    const purposeMatch = markup.match(/Purpose<\/span><p[^>]*>(.*?)<\/p>/);
    expect(purposeMatch).not.toBeNull();
    const purposeText = purposeMatch![1];

    expect(purposeText).not.toMatch(/\b(confirmed|reconciled|satisfied|passed|approved)\b/i);
  });

  it("distinguishes no approval request from an actual pending approval", async () => {
    const markup = renderToStaticMarkup(
      await MilestoneDetailPage({
        params: Promise.resolve({ milestoneId: scenario.milestone.id }),
        searchParams: Promise.resolve({ state: "DRAFT" }),
      }),
    );

    expect(markup).toContain("Approval not requested");
    expect(markup).not.toContain("Awaiting founder decision");
    expect(markup).not.toContain("Approve exact release");
  });
});
