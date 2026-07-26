import { expect, test, type Page } from "@playwright/test";
import {
  mockAdminOps,
  mockSuperWorkspaceMutate,
  mockSystemStatus,
  mockUnauthenticatedSession,
  navigateApp,
  setSuperAdminSession,
  setWorkspaceAdminSession,
  waitForPublicAuthBootstrap,
} from "./helpers/testHarness";

const setTenantAccountSession = async (page: Page) => {
  await page.waitForFunction(() => typeof window.__itemtraxxTest?.setTenantAccountSession === "function");
  await waitForPublicAuthBootstrap(page);
  await page.evaluate(() => window.__itemtraxxTest?.setTenantAccountSession("tenant-e2e"));
};

const dismissFirstRunSurfaces = async (page: Page) => {
  await page.evaluate(() => {
    const completedAt = new Date().toISOString();
    window.localStorage.setItem("itemtraxx:onboarding:v1:tenant_account", completedAt);
    window.localStorage.setItem("itemtraxx:onboarding:v1:workspace_admin", completedAt);
    window.localStorage.setItem(
      "itemtraxx-cookie-consent",
      JSON.stringify({
        version: 2,
        preferences: { analytics: false, diagnostics: false },
        updatedAt: completedAt,
      })
    );
  });
};

test.describe("workspace model role surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
    await mockAdminOps(page);
    await page.route("**/rest/v1/**", async (route) => {
      const url = new URL(route.request().url());
      const table = url.pathname.split("/").at(-1);
      const rows = table === "items"
        ? [{ id: "item-1", name: "Camera", barcode: "CAM-1", status: "available" }]
        : table === "borrowers"
        ? [{ id: "borrower-1", username: "Borrower One", borrower_id: "B-1" }]
        : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    });
  });

  test("Tenant Account receives flat reduced views and its own session controls", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/, async (route) => {
      const body = route.request().postDataJSON() as { action?: string };
      const data = body.action === "list_sessions"
        ? { sessions: [{ id: "session-1", device_id: "device-1", device_label: "Front desk", user_agent: null, login_method: "password", login_location: "regular_login", general_location: null, created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), is_current: true }] }
        : body.action === "revoke_session" ? { revoked: true } : {};
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });
    });
    await page.goto("/");
    await dismissFirstRunSurfaces(page);
    await setTenantAccountSession(page);

    await navigateApp(page, "/items");
    await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
    await expect(page.getByText("Camera")).toBeVisible();
    await expect(page.getByRole("columnheader")).toHaveCount(3);

    await navigateApp(page, "/borrowers");
    await expect(page.getByText("Borrower One")).toBeVisible();
    await expect(page.getByRole("columnheader")).toHaveCount(2);

    await navigateApp(page, "/settings");
    await expect(page.getByRole("heading", { name: "Device sessions" })).toBeVisible();
    await expect(page.getByText(/Front desk/)).toBeVisible();
  });

  test("Workspace Admin item creation requires an explicit access choice", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/workspace-admin-mutate(?:\?.*)?$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) });
    });
    await page.goto("/");
    await dismissFirstRunSurfaces(page);
    await setWorkspaceAdminSession(page);
    await navigateApp(page, "/admin/items");

    const all = page.getByRole("radio", { name: "All Tenant Accounts" });
    const restricted = page.getByRole("radio", { name: "Specific Tenant Accounts" });
    await expect(all).not.toBeChecked();
    await expect(restricted).not.toBeChecked();
    await page.getByPlaceholder("Item name").fill("Explicit choice item");
    await page.getByPlaceholder("Barcode", { exact: true }).fill("EXPLICIT-1");
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByText("Choose All Tenant Accounts or select at least one specific account.")).toBeVisible();
  });

  test("Super Admin can manage Tenant Accounts across workspaces", async ({ page }) => {
    const actions: string[] = [];
    await mockSuperWorkspaceMutate(page);
    await page.route(/\/functions(?:\/v1)?\/super-admin-mutate(?:\?.*)?$/, async (route) => {
      const body = route.request().postDataJSON() as { action?: string; payload?: Record<string, unknown> };
      actions.push(body.action ?? "");
      if (body.action === "list_tenant_accounts") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            data: [{
              id: "account-1",
              workspace_id: "tenant-1",
              workspace_name: "Demo Tenant",
              auth_email: "desk@demo.test",
              role: "tenant_account",
              is_active: true,
              deleted_at: null,
              created_at: new Date().toISOString(),
            }],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { success: true } }),
      });
    });
    await page.goto("/");
    await dismissFirstRunSurfaces(page);
    await setSuperAdminSession(page);
    await navigateApp(page, "/super-admin/tenant-accounts");

    await expect(page.getByRole("heading", { name: "Tenant Accounts" })).toBeVisible();
    const emailInput = page.getByRole("textbox", { name: "Email for Demo Tenant" });
    const saveEmail = page.getByRole("button", { name: "Save email" });
    await expect(emailInput).toHaveValue("desk@demo.test");
    await expect(saveEmail).toBeDisabled();
    await emailInput.fill("new-desk@demo.test");
    await expect(saveEmail).toBeEnabled();
    await page.getByRole("button", { name: "Suspend" }).click();
    await expect.poll(() => actions).toContain("set_tenant_account_status");
  });
});
