import { expect, test } from "@playwright/test";

test.describe("verification agent activity", () => {
  test("shows sanitized ordered activity labels and approval-required state", async ({ page }) => {
    const visible = (
      locator: ReturnType<import("@playwright/test").Page["getByLabel"]>,
    ) => locator.locator("visible=true").first();

    await page.goto("/app/activity");

    await expect(page.getByRole("heading", { name: "Verification Agent Activity" })).toBeVisible();
    await expect(page.getByText("APPROVAL_REQUIRED").first()).toBeVisible();
    await expect(page.getByText("1.00 USDC")).toBeVisible();
    await expect(page.getByText("AI").first()).toBeVisible();
    await expect(page.getByText("DETERMINISTIC").first()).toBeVisible();
    await expect(page.getByText("HUMAN").first()).toBeVisible();
    await expect(visible(page.getByLabel("Application mode: MOCK"))).toBeVisible();
    await expect(page.getByText("Exact intent hash")).toBeVisible();
    await expect(page.getByText(/^sha256:[a-f0-9]{64}$/)).toBeVisible();

    await expect(page.getByText("private://")).toHaveCount(0);
    await expect(page.getByText("sk-")).toHaveCount(0);
  });
});
