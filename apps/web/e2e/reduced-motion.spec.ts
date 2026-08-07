import { expect, test } from "@playwright/test";

const isNarrowViewport = (viewport: { width: number } | null) => (viewport?.width ?? 0) < 768;

test.describe("reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("mobile nav drawer opens near-instantly with reduced motion", async ({ page }, testInfo) => {
    test.skip(!isNarrowViewport(testInfo.project.use.viewport ?? null), "drawer trigger is only visible below md");
    await page.goto("/app/overview");

    const trigger = page.getByRole("button", { name: "Open navigation menu" });
    const start = Date.now();
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const elapsed = Date.now() - start;

    // The global prefers-reduced-motion CSS override zeroes animation and
    // transition durations, so the drawer should be visible well under the
    // Sheet's normal (non-reduced) slide-in duration.
    expect(elapsed).toBeLessThan(500);
  });
});
