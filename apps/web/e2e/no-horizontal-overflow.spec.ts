import { expect, test } from "@playwright/test";

const ROUTES = [
  "/app/overview",
  "/app/milestones",
  "/app/milestones/milestone%3Alaunch-ready?state=APPROVAL_PENDING",
  "/app/milestones/milestone%3Alaunch-ready?state=REJECTED",
  "/app/milestones/milestone%3Alaunch-ready?state=FAILED",
  "/proof/demo",
];

const WIDTHS = [320, 375, 768, 1024, 1440];

// This spec sets its own viewport per-case across the full breakpoint
// matrix, so it only needs one project rather than running redundantly
// under Mobile and Short-viewport-desktop too.
test.describe("no horizontal overflow", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "Desktop Chrome", "runs once, sets its own viewport");
  });

  for (const width of WIDTHS) {
    for (const route of ROUTES) {
      test(`${route} has no horizontal overflow at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);

        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));

        expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
      });
    }
  }
});
