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

  test("trust strip remains fully visible on mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Secure auth")).toBeVisible();
    await expect(page.getByText("Audit logs")).toBeVisible();
    // Keep this resilient to copy tweaks while still validating mobile visibility.
    await expect(page.locator(".trust-strip > span").nth(2)).toBeVisible();
  });
});
