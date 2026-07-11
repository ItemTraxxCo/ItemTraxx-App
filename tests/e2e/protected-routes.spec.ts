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
      let publicSessionRequests = 0;
      await page.route("**/auth/session/me", async (route) => {
        publicSessionRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ authenticated: false, user: null, profile: null }),
        });
      });

      await page.goto(path);

      await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
      await page.waitForFunction(() => window.__itemtraxxTest !== undefined);
      await page.waitForLoadState("networkidle");
      expect(publicSessionRequests).toBe(0);
      expect(
        await page.evaluate(() => document.documentElement.dataset.itemtraxxPublicAuth)
      ).toBeUndefined();
    });
  }

  test("super admin can reach dashboard", async ({ page }) => {
    await page.goto("/");
    await setSuperAdminSession(page);

    await navigateApp(page, "/super-admin");
    await expect(page.getByRole("heading", { name: "Super Admin" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Control Center" })).toBeVisible();
  });

  test("tenant admin verification expires after 15 minutes", async ({ page }) => {
    await page.goto("/");
    await setTenantAdminSession(page);
    await page.evaluate(async () => {
      const { setAuthStateFromBackend } = await import("/src/store/authState.ts");
      setAuthStateFromBackend({
        role: "tenant_admin",
        adminVerifiedAt: new Date(Date.now() - 15 * 60_000 - 1).toISOString(),
      });
    });

    await navigateApp(page, "/tenant/admin");

    await expect(page).toHaveURL(/\/tenant\/admin-login$/);
  });

  test("super-admin secondary verification expires after 15 minutes", async ({ page }) => {
    await page.goto("/");
    await setSuperAdminSession(page);
    await page.evaluate(async () => {
      const { setAuthStateFromBackend } = await import("/src/store/authState.ts");
      setAuthStateFromBackend({
        role: "super_admin",
        hasSecondaryAuth: true,
        superVerifiedAt: new Date(Date.now() - 15 * 60_000 - 1).toISOString(),
      });
    });

    await navigateApp(page, "/super-admin");

    await expect(page).toHaveURL(/\/super-auth$/);
  });
});
