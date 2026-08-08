import { expect, test } from "@playwright/test";

test.describe("verification agent activity", () => {
  test("shows sanitized ordered activity labels and approval-required state", async ({ page }) => {
    await page.goto("/app/activity");

    await expect(page.getByRole("heading", { name: "Verification Agent Activity" })).toBeVisible();
    await expect(page.getByText("APPROVAL_REQUIRED")).toBeVisible();
    await expect(page.getByText("250.00 USDC")).toBeVisible();
    await expect(page.getByText("AI").first()).toBeVisible();
    await expect(page.getByText("DETERMINISTIC").first()).toBeVisible();
    await expect(page.getByText("HUMAN").first()).toBeVisible();
    await expect(page.getByText("MOCK").first()).toBeVisible();

    await expect(page.getByText("private://")).toHaveCount(0);
    await expect(page.getByText("sha256:")).toHaveCount(0);
    await expect(page.getByText("sk-")).toHaveCount(0);
  });
});
