import { expect, test } from "@playwright/test";

const MILESTONE_URL = "/app/milestones/milestone%3Alaunch-ready";

test.describe("resilience states", () => {
  test("offline view renders an alert naming the actual condition", async ({ page }) => {
    await page.goto(`${MILESTONE_URL}?view=offline`);
    // Next.js also mounts its own route-announcer with role="alert"; scope
    // to the state-view's alert specifically by its content.
    const alert = page.getByRole("alert").filter({ hasText: "You're offline" });
    await expect(alert).toBeVisible();
  });

  test("configuration-missing view renders a status, not an alert", async ({ page }) => {
    await page.goto(`${MILESTONE_URL}?view=config-missing`);
    await expect(page.getByRole("status").filter({ hasText: "Configuration needed" })).toBeVisible();
  });

  test("insufficient-balance view shows available and required amounts", async ({ page }) => {
    await page.goto(`${MILESTONE_URL}?view=insufficient-balance`);
    // The switcher link and the state-view heading both contain this text;
    // scope to the status region specifically.
    const state = page.getByRole("status").filter({ hasText: "Insufficient balance" });
    await expect(state).toBeVisible();
    await expect(state.getByText(/Available: .*Required:/)).toBeVisible();
  });
});
