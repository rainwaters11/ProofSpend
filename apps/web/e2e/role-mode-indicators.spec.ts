import { expect, test } from "@playwright/test";

// top-header.tsx mounts a mobile-row and a desktop-row copy of ModeBadge/
// RoleBadge simultaneously (one hidden via CSS per breakpoint, not removed
// from the DOM), and some pages render an additional page-level ModeBadge
// too, so locators must resolve to the first currently-visible match
// rather than assuming exactly one match exists.
const visible = (locator: ReturnType<import("@playwright/test").Page["getByLabel"]>) =>
  locator.locator("visible=true").first();

test.describe("role and mode indicators", () => {
  test("founder role and mock mode are visible in the app shell", async ({ page }) => {
    await page.goto("/app/overview");

    await expect(visible(page.getByLabel("Current role: Founder"))).toBeVisible();
    await expect(visible(page.getByLabel("Application mode: MOCK"))).toBeVisible();
  });

  test("backer role and mock mode are visible on the Backer View", async ({ page }) => {
    await page.goto("/proof/demo");

    await expect(visible(page.getByLabel("Current role: Backer"))).toBeVisible();
    await expect(visible(page.getByLabel("Application mode: MOCK"))).toBeVisible();
  });

  test("mode and role badges have a visible bounding box, not just DOM presence", async ({ page }) => {
    await page.goto("/app/overview");

    const modeBadge = visible(page.getByLabel("Application mode: MOCK"));
    const box = await modeBadge.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });
});
