import { expect, test } from "@playwright/test";
import {
  mockAdminOps,
  mockSuperDashboard,
  mockSystemStatus,
  mockUnauthenticatedSession,
  navigateApp,
  setSuperAdminSession,
  setTenantAccountSession,
  setWorkspaceAdminSession,
} from "./helpers/testHarness";

test.describe("Better Auth authorization boundaries", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
    await mockAdminOps(page);
    await mockSuperDashboard(page);
    await page.goto("/");
  });

  test("unauthenticated users cannot open account security", async ({ page }) => {
    await navigateApp(page, "/account/security");
    await expect(page).toHaveURL(/\/$/);
  });

  test("tenant accounts can manage their own security but not admin or SSO", async ({ page }) => {
    await setTenantAccountSession(page);
    await navigateApp(page, "/account/security");
    await expect(page.getByRole("heading", { name: "Account security" })).toBeVisible();
    await navigateApp(page, "/admin/settings/sso");
    await expect(page).not.toHaveURL(/\/admin\/settings\/sso$/);
    await navigateApp(page, "/super-admin");
    await expect(page).not.toHaveURL(/\/super-admin$/);
  });

  test("workspace admins cannot cross into global administration", async ({ page }) => {
    await setWorkspaceAdminSession(page, "workspace-a");
    await navigateApp(page, "/super-admin/settings/sso");
    await expect(page).not.toHaveURL(/\/super-admin\/settings\/sso$/);
  });

  test("workspace admin SSO requests cannot target another organization", async ({ page }) => {
    await setWorkspaceAdminSession(page, "workspace-a");
    await page.route("**/api/itemtraxx/sso/providers?organizationId=workspace-b", (route) =>
      route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Forbidden" }) }),
    );
    const status = await page.evaluate(async () => {
      const response = await fetch("/api/itemtraxx/sso/providers?organizationId=workspace-b", { credentials: "include" });
      return response.status;
    });
    expect(status).toBe(403);
  });

  test("client-side role storage cannot grant super-admin access", async ({ page }) => {
    await setTenantAccountSession(page);
    await page.evaluate(() => {
      localStorage.setItem("role", "super_admin");
      sessionStorage.setItem("organizationId", "workspace-b");
    });
    await navigateApp(page, "/super-admin");
    await expect(page).not.toHaveURL(/\/super-admin$/);
  });

  test("super admins retain global SSO oversight", async ({ page }) => {
    await setSuperAdminSession(page);
    await page.route("**/api/itemtraxx/sso/providers", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        organizationId: null,
        providers: [],
        workspaces: [{ id: "workspace-a", name: "Workspace A", organizationId: "workspace-a" }],
      }),
    }));
    await navigateApp(page, "/super-admin/settings/sso");
    await expect(page.getByRole("heading", { name: "Enterprise SSO" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Workspace A" })).toHaveCount(1);
  });

  test("super-auth uses credential re-verification instead of the retired email-code flow", async ({ page }) => {
    await page.goto("/");
    await setSuperAdminSession(page, { verified: false });
    await navigateApp(page, "/super-admin");

    await expect(page).toHaveURL(/\/super-auth$/);
    await expect(page.getByRole("heading", { name: "Super Admin Verification" })).toBeVisible();
    await expect(page.getByPlaceholder("Enter password")).toBeVisible();
    await expect(page.getByPlaceholder("Enter 6-digit code")).toHaveCount(0);
  });
});

test.describe("Better Auth two-factor challenge", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
  });

  test("incorrect TOTP fails closed", async ({ page }) => {
    await page.route("**/api/auth/two-factor/verify-totp", (route) => route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ code: "INVALID_CODE", message: "Invalid code" }),
    }));
    await page.goto("/login/two-factor");
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Verify authenticator code" }).click();
    await expect(page.getByText("Invalid code")).toBeVisible();
    await expect(page).toHaveURL(/\/login\/two-factor$/);
  });

  test("used or invalid backup code fails closed", async ({ page }) => {
    await page.route("**/api/auth/two-factor/verify-backup-code", (route) => route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ code: "INVALID_BACKUP_CODE", message: "Invalid backup code" }),
    }));
    await page.goto("/login/two-factor");
    await page.getByLabel("Code").fill("used-backup-code");
    await page.getByRole("button", { name: "Use backup code" }).click();
    await expect(page.getByText("Invalid backup code")).toBeVisible();
  });
});
