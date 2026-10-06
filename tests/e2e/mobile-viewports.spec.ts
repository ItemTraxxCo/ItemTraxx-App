import { expect, test } from "@playwright/test";
import { mockSystemStatus, mockUnauthenticatedSession } from "./helpers/testHarness";

test.describe("Mobile viewport coverage", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
  });

  test("landing CTA buttons stay visible on mobile", async ({ page }) => {
    await page.goto("/");
    const heroActions = page.locator(".hero-actions");
    await expect(heroActions.getByRole("link", { name: "Pricing", exact: true })).toBeVisible();
    await expect(heroActions.getByRole("link", { name: "Get a demo", exact: true })).toBeVisible();
  });

  test("current landing workflow summaries stay visible without horizontal overflow", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#workflow .what-row")).toHaveCount(3);
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  });
});
