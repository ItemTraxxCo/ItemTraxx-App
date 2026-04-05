import { expect, test } from "@playwright/test";
import { mockSystemStatus, navigateApp, setTenantAdminSession } from "./helpers/testHarness";

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

  test("authenticated tenant checkout survives refresh when tenant bootstrap lookup returns 401", async ({ page }) => {
    await page.route("**/auth/session/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: {
            id: "user-tenant-refresh",
            email: "tenant.user@example.com",
            last_sign_in_at: new Date().toISOString(),
          },
          profile: {
            role: "tenant_user",
            tenant_id: "tenant-e2e",
            district_id: null,
            auth_email: "tenant.user@example.com",
            is_active: true,
          },
        }),
      });
    });

    await page.route("**/rest/v1/tenants?**", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unauthorized" }),
      });
    });

    await page.goto("/tenant/checkout");
    await expect(page).toHaveURL(/\/tenant\/checkout$/);

    await page.reload();
    await expect(page).toHaveURL(/\/tenant\/checkout$/);
    await expect(page).not.toHaveURL(/\/login$/);
  });

  test("tenant admin on checkout is not logged out by admin-session validation", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/, async (route) => {
      const body = (route.request().postDataJSON() as { action?: string }) ?? {};
      if (body.action === "validate_session") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { valid: false } }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { ok: true } }),
      });
    });

    await page.goto("/");
    await setTenantAdminSession(page, "tenant-e2e");
    await navigateApp(page, "/tenant/checkout");
    await expect(page).toHaveURL(/\/tenant\/checkout$/);
    await page.reload();
    await expect(page).toHaveURL(/\/tenant\/checkout$/);
    await expect(page).not.toHaveURL(/\/login$/);
  });

  test("authenticated tenant admin on public home redirects to checkout instead of login", async ({ page }) => {
    await page.goto("/");
    await setTenantAdminSession(page, "tenant-e2e");
    await navigateApp(page, "/about");
    await expect(page).toHaveURL(/\/about$/);
    await navigateApp(page, "/");
    await expect(page).toHaveURL(/\/tenant\/checkout$/);
    await expect(page).not.toHaveURL(/\/login$/);
  });

  test("tenant admin does not bounce from admin home to checkout immediately", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/, async (route) => {
      const body = (route.request().postDataJSON() as { action?: string }) ?? {};
      if (body.action === "validate_session") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { valid: true } }),
        });
        return;
      }
      if (body.action === "get_tenant_settings") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              checkout_due_hours: 48,
              account_category: "organization",
              plan_code: "core",
              feature_flags: {
                enable_notifications: true,
                enable_bulk_item_import: true,
                enable_bulk_student_tools: true,
                enable_status_tracking: true,
                enable_barcode_generator: true,
              },
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { ok: true } }),
      });
    });

    await page.goto("/");
    await setTenantAdminSession(page, "tenant-e2e");
    await navigateApp(page, "/tenant/admin");
    await expect(page).toHaveURL(/\/tenant\/admin$/);
    await page.waitForTimeout(6000);
    await expect(page).toHaveURL(/\/tenant\/admin$/);
    await expect(page).not.toHaveURL(/\/tenant\/checkout$/);
  });

  test("tenant admin dev hosts disable idle logout behavior", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { valid: true, ok: true } }),
      });
    });

    await page.goto("/");
    await setTenantAdminSession(page, "tenant-e2e");
    await page.evaluate(() => {
      window.history.replaceState({}, "", "/tenant/admin");
    });
    await page.reload();
    await expect(page).toHaveURL(/\/tenant\/admin$/);
    await page.waitForTimeout(3500);
    await expect(page).toHaveURL(/\/tenant\/admin$/);
  });
});
