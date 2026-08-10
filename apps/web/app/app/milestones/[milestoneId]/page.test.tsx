import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildReleaseScenario } from "@/lib/release-scenario";

import MilestoneDetailPage from "./page";

describe("MilestoneDetailPage", () => {
  const scenario = buildReleaseScenario();

  it("shows the 1 test USDC proposed release amount, not the 150 test USDC spend limit", async () => {
    const markup = renderToStaticMarkup(
      await MilestoneDetailPage({
        params: Promise.resolve({ milestoneId: scenario.milestone.id }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(markup).toContain("1.00 USDC");
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

  it("renders a rejected release without implying it reached submission", async () => {
    const markup = renderToStaticMarkup(
      await MilestoneDetailPage({
        params: Promise.resolve({ milestoneId: scenario.milestone.id }),
        searchParams: Promise.resolve({ state: "REJECTED" }),
      }),
    );

    expect(markup).toContain("Lifecycle ended at founder approval: Rejected");
    expect(markup).not.toContain("Lifecycle ended: Failed");
  });

  it("renders the offline resilience view via ?view=offline, bypassing the lifecycle panels", async () => {
    const markup = renderToStaticMarkup(
      await MilestoneDetailPage({
        params: Promise.resolve({ milestoneId: scenario.milestone.id }),
        searchParams: Promise.resolve({ view: "offline" }),
      }),
    );

    expect(markup).toContain("You&#x27;re offline");
    expect(markup).not.toContain("Preview a lifecycle state");
  });

  it("renders the configuration-missing resilience view via ?view=config-missing", async () => {
    const markup = renderToStaticMarkup(
      await MilestoneDetailPage({
        params: Promise.resolve({ milestoneId: scenario.milestone.id }),
        searchParams: Promise.resolve({ view: "config-missing" }),
      }),
    );

    expect(markup).toContain("Configuration needed");
  });

  it("renders the insufficient-balance resilience view via ?view=insufficient-balance", async () => {
    const markup = renderToStaticMarkup(
      await MilestoneDetailPage({
        params: Promise.resolve({ milestoneId: scenario.milestone.id }),
        searchParams: Promise.resolve({ view: "insufficient-balance" }),
      }),
    );

    expect(markup).toContain("Insufficient balance");
    expect(markup).toContain("Available: 0.50 USDC");
  });

  it("ignores an unrecognized ?view= value and falls back to the lifecycle panels", async () => {
    const markup = renderToStaticMarkup(
      await MilestoneDetailPage({
        params: Promise.resolve({ milestoneId: scenario.milestone.id }),
        searchParams: Promise.resolve({ view: "not-a-real-view" }),
      }),
    );

    expect(markup).toContain("Preview a lifecycle state");
  });
});
