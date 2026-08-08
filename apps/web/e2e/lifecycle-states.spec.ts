import { expect, test } from "@playwright/test";

const MILESTONE_URL = "/app/milestones/milestone%3Alaunch-ready";

test.describe("lifecycle states", () => {
  test("rejected and failed render distinct banner text and icons", async ({ page }) => {
    await page.goto(`${MILESTONE_URL}?state=REJECTED`);
    await expect(page.getByText("Lifecycle ended at founder approval: Rejected")).toBeVisible();

    await page.goto(`${MILESTONE_URL}?state=FAILED`);
    await expect(page.getByText("Lifecycle ended: Failed")).toBeVisible();
    await expect(page.getByText("Lifecycle ended at founder approval")).toHaveCount(0);
  });

  test("every lifecycle state preview never implies live data", async ({ page }) => {
    const states = [
      "ELIGIBLE",
      "APPROVAL_PENDING",
      "APPROVED",
      "PREPARED",
      "SUBMITTED",
      "CONFIRMED",
      "RECONCILED",
      "REJECTED",
      "FAILED",
    ];

    for (const state of states) {
      await page.goto(`${MILESTONE_URL}?state=${state}`);
      await expect(page.getByText("MOCK", { exact: true }).locator("visible=true").first()).toBeVisible();
      // No transaction hash or explorer link on this mock scenario should
      // ever render as a live, clickable Arc Testnet link.
      const explorerLink = page.getByRole("link", { name: /opens Arc Testnet explorer/ });
      await expect(explorerLink).toHaveCount(0);
    }
  });
});
