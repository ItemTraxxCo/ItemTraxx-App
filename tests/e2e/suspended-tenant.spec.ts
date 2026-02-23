import { expect, test } from "@playwright/test";
import {
  mockSuspendedTenantAdminOps,
  mockSystemStatus,
  navigateApp,
  setTenantAdminSession,
} from "./helpers/testHarness";

test.describe("Suspended tenant behavior", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockSuspendedTenantAdminOps(page);
  });

  test("suspended tenant admin write receives blocked response", async ({ page }) => {
    await page.goto("/");
    await setTenantAdminSession(page);
    await navigateApp(page, "/tenant/admin/settings");

    const responsePromise = page.waitForResponse((response) =>
      response.url().includes("/functions/admin-ops") &&
      response.request().method() === "POST" &&
      response.status() === 403
    );

    await page.evaluate(() => {
      fetch("/functions/admin-ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_tenant_settings", payload: { checkout_due_hours: 24 } }),
      }).catch(() => undefined);
    });

    const blocked = await responsePromise;
    await expect(blocked.status()).toBe(403);
  });
});
