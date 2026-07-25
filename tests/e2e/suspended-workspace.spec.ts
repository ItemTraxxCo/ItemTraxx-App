import { expect, test } from "@playwright/test";
import {
  mockSuspendedWorkspaceAdminOps,
  mockSystemStatus,
  mockUnauthenticatedSession,
  navigateApp,
  setWorkspaceAdminSession,
} from "./helpers/testHarness";

test.describe("Suspended workspace behavior", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
    await mockSuspendedWorkspaceAdminOps(page);
  });

  test("suspended Workspace Admin write receives blocked response", async ({ page }) => {
    await page.goto("/");
    await setWorkspaceAdminSession(page);
    await navigateApp(page, "/admin/settings");

    const responsePromise = page.waitForResponse((response) =>
      response.url().includes("/functions/admin-ops") &&
      response.request().method() === "POST" &&
      response.status() === 403
    );

    await page.evaluate(() => {
      fetch("/functions/admin-ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_workspace_settings", payload: { checkout_due_hours: 24 } }),
      }).catch(() => undefined);
    });

    const blocked = await responsePromise;
    await expect(blocked.status()).toBe(403);
  });
});
