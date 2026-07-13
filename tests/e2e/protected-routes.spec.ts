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

  test("offline queue badge follows real queue storage transitions", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("itemtraxx:onboarding:v1:tenant_admin", new Date().toISOString());
    });
    await setTenantAdminSession(page);
    await navigateApp(page, "/tenant/checkout");

    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("menuitem", { name: "Open Admin Panel" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Take tour again" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Offline Queue: 0" })).toHaveAttribute(
      "title",
      /auto-syncs them when connection is restored/,
    );

    await page.evaluate(async () => {
      await window.__itemtraxxTest?.offlineCheckoutQueue.queue({
        student_id: "student-shell-e2e",
        gear_barcodes: ["GEAR-SHELL-E2E"],
        action_type: "checkout",
        operation_id: "operation-shell-e2e",
      });
      window.dispatchEvent(
        new StorageEvent("storage", { key: "itemtraxx:checkout-offline-buffer:v1" }),
      );
    });
    await expect(page.getByRole("menuitem", { name: "Offline Queue: 1" })).toBeVisible();

    await page.evaluate(async () => {
      await window.__itemtraxxTest?.offlineCheckoutQueue.write([]);
      window.dispatchEvent(
        new StorageEvent("storage", { key: "itemtraxx:checkout-offline-buffer:v1" }),
      );
    });
    await expect(page.getByRole("menuitem", { name: "Offline Queue: 0" })).toBeVisible();
  });

  test("onboarding completion survives reload and replay reopens the tour", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("itemtraxx:onboarding:v1:tenant_admin");
    });
    await setTenantAdminSession(page);
    await navigateApp(page, "/tenant/checkout");

    const dialog = page.getByRole("dialog", { name: /ItemTraxx onboarding step/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close onboarding" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() =>
      page.evaluate(() => localStorage.getItem("itemtraxx:onboarding:v1:tenant_admin")),
    ).not.toBeNull();

    await page.reload();
    await expect(page).toHaveURL(/\/tenant\/checkout$/);
    await page.waitForFunction(
      () => typeof window.__itemtraxxTest?.setTenantAdminSession === "function",
    );
    await page.evaluate(() => window.__itemtraxxTest?.setTenantAdminSession("tenant-e2e"));
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Take tour again" }).click();
    await expect(dialog).toBeVisible();
  });

  test("authenticated users can dismiss a degraded incident without changing its status link", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/system-status(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "degraded",
          incident_summary: "Checkout latency is elevated",
          checked_at: "2026-07-13T12:00:00.000Z",
          maintenance: { enabled: false, message: "" },
        }),
      });
    });
    await page.goto("/");
    await setTenantAdminSession(page);
    await navigateApp(page, "/tenant/checkout");

    const banner = page.getByRole("status").filter({ hasText: "Checkout latency is elevated" });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("link", { name: "View status" })).toHaveAttribute(
      "href",
      "https://status.itemtraxx.com/?ref=bcastlink",
    );
    await banner.getByRole("button").click();
    await expect(banner).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("itemtraxx-incident-dismissed"))).toBe(
      "2026-07-13T12:00:00.000Z",
    );
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
