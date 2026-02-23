import { expect, test } from "@playwright/test";
import {
  mockSuperAdminMutate,
  mockSuperDashboard,
  mockSuperGearMutate,
  mockSuperLogsQuery,
  mockSuperStudentMutate,
  mockSuperTenantMutate,
  mockSystemStatus,
  navigateApp,
  setSuperAdminSession,
} from "./helpers/testHarness";

test.describe("Super admin flows and export actions", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockSuperDashboard(page);
    await mockSuperTenantMutate(page);
    await mockSuperAdminMutate(page);
    await mockSuperGearMutate(page);
    await mockSuperStudentMutate(page);
    await mockSuperLogsQuery(page);
  });

  test("can navigate super pages and sees export actions", async ({ page }) => {
    await page.goto("/");
    await setSuperAdminSession(page);

    await navigateApp(page, "/super-admin/tenants");
    await expect(page.getByRole("heading", { name: "Tenant Management" })).toBeVisible();

    await navigateApp(page, "/super-admin/admins");
    await expect(page.getByRole("heading", { name: "Tenant Admin Management" })).toBeVisible();

    await navigateApp(page, "/super-admin/gear");
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export PDF" })).toBeVisible();

    await navigateApp(page, "/super-admin/students");
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export PDF" })).toBeVisible();

    await navigateApp(page, "/super-admin/logs");
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export PDF" })).toBeVisible();
  });
});
