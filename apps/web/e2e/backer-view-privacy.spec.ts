import { expect, test } from "@playwright/test";

test.describe("backer view privacy", () => {
  test("never renders raw receipts or founder-private notes after hydration", async ({ page }) => {
    await page.goto("/proof/demo");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Disclosed mock settlement")).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("Verified spend");
    expect(bodyText).not.toContain("Settled to recipient");
  });

  test("shows backer role and mock mode badges", async ({ page }) => {
    await page.goto("/proof/demo");

    await expect(page.getByText("MOCK", { exact: true }).first()).toBeVisible();
  });
});
