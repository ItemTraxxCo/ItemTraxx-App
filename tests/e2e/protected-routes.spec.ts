import { expect, test } from "@playwright/test";
import {
  mockAdminOps,
  navigateApp,
  mockSuperDashboard,
  mockSystemStatus,
  mockUnauthenticatedSession,
  setSuperAdminSession,
  setTenantAdminSession,
} from "./helpers/testHarness";

test.describe("Protected route smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
    await mockAdminOps(page);
    await mockSuperDashboard(page);
  });

  test("tenant admin can reach admin home and status tracking", async ({ page }) => {
    await page.goto("/");
    await setTenantAdminSession(page);

    await navigateApp(page, "/tenant/admin");
    await expect(page.getByRole("heading", { name: "Admin Panel", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Item Status Tracking" })).toBeVisible();

    await navigateApp(page, "/tenant/admin/item-status");
    await expect(page.getByRole("heading", { name: "Item Status Tracking" })).toBeVisible();
  });

  for (const path of ["/tenant/checkout", "/district"]) {
    test(`E2E first mount of protected ${path} does not use public auth bootstrap`, async ({ page }) => {
      await page.goto(path);

      await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.dataset.itemtraxxPublicAuth ?? null)
        )
        .not.toBe("settled");
    });
  }

  test("super admin can reach dashboard", async ({ page }) => {
    await page.goto("/");
    await setSuperAdminSession(page);

    await navigateApp(page, "/super-admin");
    await expect(page.getByRole("heading", { name: "Super Admin" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Control Center" })).toBeVisible();
  });
});
