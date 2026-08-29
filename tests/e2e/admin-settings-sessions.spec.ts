import { expect, test } from "@playwright/test";
import {
  mockAdminOps,
  mockSystemStatus,
  mockUnauthenticatedSession,
  navigateApp,
  setWorkspaceAdminSession,
} from "./helpers/testHarness";

test.describe("admin settings device sessions repro", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
  });

  test("bulk sign-out excludes current device and dropdown opens", async ({ page }) => {
    const revokedAll: unknown[] = [];
    const currentSession = {
      id: "session-1",
      device_id: "device-current",
      device_label: "Admin laptop",
      user_agent: null,
      login_method: "password",
      login_location: "admin_login",
      general_location: "Portland, OR",
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      is_current: true,
    };
    const remoteSession = {
      id: "session-2",
      device_id: "device-remote",
      device_label: "Home laptop",
      user_agent: null,
      login_method: "magic_link",
      login_location: "regular_login",
      general_location: "Seattle, WA",
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      is_current: false,
    };
    let revokedRemote = false;

    await mockAdminOps(page);
    await page.route(/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/, async (route) => {
      const body = route.request().postDataJSON() as { action?: string; payload?: Record<string, unknown> };
      if (body.action === "list_sessions") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: { sessions: [currentSession, ...(revokedRemote ? [] : [remoteSession])] },
          }),
        });
        return;
      }
      if (body.action === "revoke_all_sessions") {
        revokedAll.push(body.payload);
        revokedRemote = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { revoked: 1 } }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto("/");
    await page.evaluate(() => {
      window.localStorage.setItem("itemtraxx:onboarding:v1:workspace_admin", new Date().toISOString());
    });
    await setWorkspaceAdminSession(page);
    await navigateApp(page, "/admin/settings");

    await expect(page.getByRole("heading", { name: "Active Devices" })).toBeVisible();
    await expect(page.getByText("Home laptop")).toBeVisible();

    // Three-dot dropdown check
    const remoteActions = page.getByRole("button", { name: "Open actions for Home laptop" });
    await expect(remoteActions).toBeVisible();
    await remoteActions.click();
    await expect(page.getByRole("menuitem", { name: "Revoke device" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Bulk sign-out-others check
    let confirmationSeen = false;
    page.once("dialog", async (dialog) => {
      confirmationSeen = true;
      await dialog.accept();
    });
    await page.getByRole("button", { name: "Sign out all other devices" }).click();
    expect(confirmationSeen).toBe(true);

    await expect.poll(() => revokedAll.length).toBe(1);
    // Give any polling/heartbeat logic a chance to react before asserting.
    await page.waitForTimeout(1000);

    // Current session must remain: no forced logout / termination banner, still on /admin/settings.
    await expect(page).toHaveURL(/\/admin\/settings/);
    await expect(page.getByText("Admin laptop")).toBeVisible();
    await expect(page.getByText("This device")).toBeVisible();
  });
});
