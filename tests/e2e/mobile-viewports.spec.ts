import { expect, test } from "@playwright/test";
import { mockSystemStatus } from "./helpers/testHarness";

test.describe("Mobile viewport coverage", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
  });

  test("landing CTA buttons stay visible on mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Pricing" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Request Demo" }).first()).toBeVisible();
  });

  test("hero benefit points remain fully visible on mobile", async ({ page }) => {
    await page.goto("/");
    const heroPoints = page.locator(".hero-points li");
    await expect(heroPoints.filter({ hasText: "Secure sign-ins and protected admin access" })).toBeVisible();
    await expect(heroPoints.filter({ hasText: "Clear transaction history and audit visibility" })).toBeVisible();
    await expect(heroPoints.filter({ hasText: "Easy item and user management features" })).toBeVisible();
  });
});
