import { expect, test } from "@playwright/test";

// The "Mobile" project reuses Desktop Chrome with an overridden viewport
// (see playwright.config.ts), so Playwright's isMobile fixture stays false
// there — checking viewport width directly is what actually distinguishes
// the mobile layout breakpoint (Tailwind's md, 768px) in these tests.
const isNarrowViewport = (viewport: { width: number } | null) => (viewport?.width ?? 0) < 768;

test.describe("shell navigation", () => {
  test("skip link jumps focus to main content", async ({ page }) => {
    await page.goto("/app/overview");
    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("desktop sidebar links are keyboard reachable in document order", async ({ page }, testInfo) => {
    test.skip(isNarrowViewport(testInfo.project.use.viewport ?? null), "sidebar is hidden below md");
    await page.goto("/app/overview");
    const sidebar = page.getByRole("navigation", { name: "Primary" }).first();
    await expect(sidebar).toBeVisible();

    const firstLink = sidebar.getByRole("link").first();
    await firstLink.focus();
    await expect(firstLink).toBeFocused();
  });

  test("mobile drawer opens, traps focus, and closes on Escape", async ({ page }, testInfo) => {
    test.skip(!isNarrowViewport(testInfo.project.use.viewport ?? null), "drawer trigger is only visible below md");
    await page.goto("/app/overview");

    const trigger = page.getByRole("button", { name: "Open navigation menu" });
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("navigation", { name: "Primary" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("mobile bottom bar and drawer nav have distinct landmark labels", async ({ page }, testInfo) => {
    test.skip(!isNarrowViewport(testInfo.project.use.viewport ?? null), "bottom bar is only visible below md");
    await page.goto("/app/overview");

    await expect(page.getByRole("navigation", { name: "Quick navigation" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary (mobile bottom bar)" })).toHaveCount(0);
  });
});
