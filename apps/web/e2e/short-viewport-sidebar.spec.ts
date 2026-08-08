import { expect, test } from "@playwright/test";

test.describe("short-viewport sidebar", () => {
  test.skip(({ viewport }) => !viewport || viewport.height > 600, "only meaningful on the short-viewport project");

  test("last nav item and collapse button stay reachable via keyboard", async ({ page }) => {
    await page.goto("/app/overview");

    const sidebar = page.getByRole("navigation", { name: "Primary" }).first();
    const links = sidebar.getByRole("link");
    const lastLink = links.last();

    await lastLink.scrollIntoViewIfNeeded();
    await expect(lastLink).toBeVisible();

    await lastLink.focus();
    await expect(lastLink).toBeFocused();

    const collapseButton = page.getByRole("button", { name: /Collapse sidebar|Expand sidebar/ });
    await expect(collapseButton).toBeVisible();
  });

  test("nav list scrolls independently instead of clipping items", async ({ page }) => {
    await page.goto("/app/overview");

    const sidebar = page.getByRole("navigation", { name: "Primary" }).first();
    const list = sidebar.locator("ul");

    // Not asserting the list is currently overflowing (depends on exact
    // viewport/content sizing), but asserting the mechanism exists:
    // overflow-y must be auto or scroll, never visible/hidden, so it *can*
    // scroll when it needs to.
    const overflowY = await list.evaluate((el) => getComputedStyle(el).overflowY);
    expect(["auto", "scroll"]).toContain(overflowY);
  });
});
