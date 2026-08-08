import { expect, test } from "@playwright/test";

const isNarrowViewport = (viewport: { width: number } | null) => (viewport?.width ?? 0) < 768;

test.describe("reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("mobile nav drawer opens near-instantly with reduced motion", async ({ page }, testInfo) => {
    test.skip(!isNarrowViewport(testInfo.project.use.viewport ?? null), "drawer trigger is only visible below md");
    await page.goto("/app/overview");

    const trigger = page.getByRole("button", { name: "Open navigation menu" });
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const durations = await dialog.evaluate((element) => {
      const styles = window.getComputedStyle(element);
      return {
        animation: styles.animationDuration,
        transition: styles.transitionDuration,
      };
    });

    const maximumDurationMs = (value: string) =>
      Math.max(
        ...value.split(",").map((duration) => {
          const normalized = duration.trim();
          const amount = Number.parseFloat(normalized);
          return normalized.endsWith("ms") ? amount : amount * 1_000;
        }),
      );

    // Assert the actual CSS durations. Visibility alone only proves that the
    // dialog mounted; it does not prove the slide transition was removed.
    expect(maximumDurationMs(durations.animation)).toBeLessThanOrEqual(1);
    expect(maximumDurationMs(durations.transition)).toBeLessThanOrEqual(1);
  });
});
