import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  mockSystemStatus,
  mockUnauthenticatedSession,
  navigateApp,
  setTenantAdminSession,
  waitForPublicAuthBootstrap,
} from "./helpers/testHarness";

const authenticatedSessionSummary = () => ({
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
});

test.describe("Auth edge cases", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
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

  test("public session bootstrap renders for an unauthenticated session without contacting Supabase", async ({ page }) => {
    const requestedUrls: string[] = [];
    let sessionSummaryRequests = 0;
    page.on("request", (request) => requestedUrls.push(request.url()));
    await page.route("**/auth/session/me", async (route) => {
      sessionSummaryRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: false, user: null, profile: null }),
      });
    });

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "ItemTraxx", exact: true })).toBeVisible();
    await waitForPublicAuthBootstrap(page);
    await expect.poll(() => sessionSummaryRequests).toBe(1);
    expect(requestedUrls.some((url) => /\.supabase\.(?:co|in)\//.test(url))).toBe(false);
  });

  for (const path of [
    "/forgot-password",
    "/legal/student-privacy",
    "/landing-old",
    "/landing-new2",
  ]) {
    test(`${path} uses public auth bootstrap on first mount`, async ({ page }) => {
      await page.goto(path);

      await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
      await waitForPublicAuthBootstrap(page);
    });
  }

  test("normal production entry graph does not statically own E2E controls", async () => {
    const mainSource = await readFile(new URL("../../src/main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain('await import("./e2e/testControls")');
    expect(mainSource).not.toMatch(/from ["']\.\/e2e\/testControls["']/);
  });

  test("public session bootstrap preserves the authenticated role redirect", async ({ page }) => {
    let sessionSummaryRequests = 0;
    await page.route("**/auth/session/me", async (route) => {
      sessionSummaryRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(authenticatedSessionSummary()),
      });
    });
    await page.route("**/rest/v1/tenants?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "tenant-e2e", status: "active", district_id: "district-e2e" },
        ]),
      });
    });
    await page.route("**/rest/v1/rpc/resolve_public_district_by_id", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "district-e2e",
            name: "E2E District",
            slug: "e2e-district",
            is_active: true,
          },
        ]),
      });
    });
    await page.route("https://e2e-district.app.itemtraxx.com/tenant/checkout", async (route) => {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html>" });
    });

    await page.goto("/");

    await expect.poll(() => sessionSummaryRequests).toBe(1);
    await expect(page).toHaveURL("https://e2e-district.app.itemtraxx.com/tenant/checkout");
  });

  test("authenticated tenant checkout survives refresh when tenant bootstrap lookup returns 401", async ({ page }) => {
    await page.route("**/auth/session/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(authenticatedSessionSummary()),
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

  test("authenticated tenant admin on public marketing routes is not forced to checkout or login", async ({ page }) => {
    await page.goto("/");
    await setTenantAdminSession(page, "tenant-e2e");
    await navigateApp(page, "/about");
    await expect(page).toHaveURL(/\/about$/);
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

  test("hidden tenant admin navigation defers session polling until visibility returns", async ({ page }) => {
    let touchRequests = 0;
    let validationRequests = 0;
    await page.route(/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/, async (route) => {
      const body = (route.request().postDataJSON() as { action?: string }) ?? {};
      if (body.action === "touch_session") touchRequests += 1;
      if (body.action === "validate_session") validationRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { ok: true, valid: true } }),
      });
    });

    await page.goto("/");
    await setTenantAdminSession(page, "tenant-e2e");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await navigateApp(page, "/tenant/admin");
    await page.waitForTimeout(250);

    expect(touchRequests).toBe(0);
    expect(validationRequests).toBe(0);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await expect.poll(() => touchRequests).toBe(1);
    await expect.poll(() => validationRequests).toBe(1);
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
