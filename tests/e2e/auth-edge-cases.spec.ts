import { expect, test } from "@playwright/test";
import { mockSystemStatus, navigateApp } from "./helpers/testHarness";

test.describe("Auth edge cases", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
  });

  test("unauthenticated tenant admin route redirects to public home", async ({ page }) => {
    await page.goto("/");
    await navigateApp(page, "/tenant/admin");
    await expect(page).toHaveURL(/\/$/);
  });

  test("unauthenticated super admin route redirects to public home", async ({ page }) => {
    await page.goto("/");
    await navigateApp(page, "/super-admin");
    await expect(page).toHaveURL(/\/$/);
  });
});
