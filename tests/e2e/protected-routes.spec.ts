import { expect, test } from "@playwright/test";
import {
  mockAdminOps,
  navigateApp,
  mockSuperDashboard,
  mockSystemStatus,
  mockUnauthenticatedSession,
  setSuperAdminSession,
  setWorkspaceAdminSession,
} from "./helpers/testHarness";

test.describe("Protected route smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
    await mockAdminOps(page);
    await mockSuperDashboard(page);
  });

  test("Workspace Admin can reach admin home and status tracking", async ({ page }) => {
    await page.goto("/");
    await setWorkspaceAdminSession(page);

    await navigateApp(page, "/admin");
    await expect(page.getByRole("heading", { name: "Workspace Overview", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Item Status Tracking" })).toBeVisible();

    await navigateApp(page, "/admin/item-status");
    await expect(page.getByRole("heading", { name: "Item Status Tracking" })).toBeVisible();
  });

  test("Workspace Admin item logs show the tenant account that completed each transaction", async ({ page }) => {
    await page.route(/\/rest\/v1\/item_logs(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          id: "log-e2e",
          workspace_id: "tenant-e2e",
          item_id: "item-e2e",
          checked_out_by: "borrower-e2e",
          action_type: "checkout",
          action_time: "2026-07-28T12:00:00.000Z",
          performed_by: "tenant-account-e2e",
          item: { name: "Camera", barcode: "CAM-100" },
          borrower: { username: "Maya Chen", borrower_id: "STU-100" },
        }]),
      });
    });
    await page.route(/\/rest\/v1\/profiles(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "tenant-account-e2e", auth_email: "long-tenant-account-name-for-library@example.edu" }]),
      });
    });

    await page.goto("/");
    await setWorkspaceAdminSession(page);
    await navigateApp(page, "/admin/logs");

    await expect(page.getByRole("columnheader", { name: "Tenant Account" })).toBeVisible();
    await expect(page.getByText("long-tenant-account-name-for-library@example.edu")).toBeVisible();
    await expect(page.locator(".tenant-account-cell")).toHaveAttribute("title", "long-tenant-account-name-for-library@example.edu");
  });

  test("offline queue toast follows real queue storage transitions", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("itemtraxx:onboarding:v1:workspace_admin", new Date().toISOString());
    });
    await setWorkspaceAdminSession(page);
    await navigateApp(page, "/checkout");

    const toast = page.locator(".toast-bottom-left");
    await expect(toast).toHaveCount(0);

    await page.evaluate(async () => {
      await window.__itemtraxxTest?.offlineCheckoutQueue.queue({
        borrower_id: "borrower-shell-e2e",
        item_barcodes: ["ITEM-SHELL-E2E"],
        action_type: "checkout",
        operation_id: "operation-shell-e2e",
      });
      window.dispatchEvent(
        new StorageEvent("storage", { key: "itemtraxx:checkout-offline-buffer:v1" }),
      );
    });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("1 transaction waiting to sync.");

    await page.evaluate(async () => {
      await window.__itemtraxxTest?.offlineCheckoutQueue.write([]);
      window.dispatchEvent(
        new StorageEvent("storage", { key: "itemtraxx:checkout-offline-buffer:v1" }),
      );
    });
    await expect(toast).toHaveCount(0);
  });

  test("onboarding completion survives reload", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("itemtraxx:onboarding:v1:workspace_admin");
    });
    await setWorkspaceAdminSession(page);
    await navigateApp(page, "/checkout");

    const dialog = page.getByRole("dialog", { name: /ItemTraxx onboarding step/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close onboarding" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() =>
      page.evaluate(() => localStorage.getItem("itemtraxx:onboarding:v1:workspace_admin")),
    ).not.toBeNull();

    await page.reload();
    await expect(page).toHaveURL(/\/checkout$/);
    await page.waitForFunction(
      () => typeof window.__itemtraxxTest?.setWorkspaceAdminSession === "function",
    );
    await page.evaluate(() => window.__itemtraxxTest?.setWorkspaceAdminSession("tenant-e2e"));
    await expect(dialog).toHaveCount(0);
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
    await setWorkspaceAdminSession(page);
    await navigateApp(page, "/checkout");

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

  for (const path of ["/checkout", "/admin"]) {
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

  test("Workspace Admin verification expires after 15 minutes", async ({ page }) => {
    await page.goto("/");
    await setWorkspaceAdminSession(page);
    await page.evaluate(async () => {
      const { setAuthStateFromBackend } = await import("/src/store/authState.ts");
      setAuthStateFromBackend({
        role: "workspace_admin",
        adminVerifiedAt: new Date(Date.now() - 15 * 60_000 - 1).toISOString(),
      });
    });

    await navigateApp(page, "/admin");

    await expect(page).toHaveURL(/\/login$/);
  });

  test("Workspace Admin password verification survives a workspace host bootstrap", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      const [{ applyHttpSessionSummary }, { clearAdminVerification }] = await Promise.all([
        import("/src/services/auth/sessionBootstrap.ts"),
        import("/src/store/authState.ts"),
      ]);
      clearAdminVerification();
      await applyHttpSessionSummary({
        authenticated: true,
        user: {
          id: "user-e2e-admin",
          email: "tenant.admin@example.com",
          last_sign_in_at: new Date().toISOString(),
        },
        profile: {
          role: "workspace_admin",
          workspace_id: "tenant-e2e",
          auth_email: "tenant.admin@example.com",
          is_active: true,
        },
        password_authenticated_at: new Date().toISOString(),
      });
    });

    await navigateApp(page, "/admin");

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Workspace Overview", exact: true })).toBeVisible();
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
