import { expect, test, type Page } from "@playwright/test";
import {
  mockAdminOps,
  mockSystemStatus,
  mockUnauthenticatedSession,
  navigateApp,
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
      const rows = table === "gear"
        ? [{ id: "item-1", name: "Camera", barcode: "CAM-1", status: "available" }]
        : table === "students"
        ? [{ id: "borrower-1", username: "Borrower One", student_id: "B-1" }]
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
    await navigateApp(page, "/admin/gear");

    const all = page.getByRole("radio", { name: "All Tenant Accounts" });
    const restricted = page.getByRole("radio", { name: "Specific Tenant Accounts" });
    await expect(all).not.toBeChecked();
    await expect(restricted).not.toBeChecked();
    await page.getByPlaceholder("Item name").fill("Explicit choice item");
    await page.getByPlaceholder("Barcode", { exact: true }).fill("EXPLICIT-1");
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByText("Choose All Tenant Accounts or select at least one specific account.")).toBeVisible();
  });

  test("Tenant Account quick return sends a distinct audit action", async ({ page }) => {
    let actionType: string | undefined;
    await page.route(/\/functions(?:\/v1)?\/checkoutReturn(?:\?.*)?$/, async (route) => {
      actionType = (route.request().postDataJSON() as { action_type?: string }).action_type;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { checkouts: [], returns: [{ id: "item-1" }] } }) });
    });
    await page.goto("/");
    await dismissFirstRunSurfaces(page);
    await setTenantAccountSession(page);
    await navigateApp(page, "/checkout");
    await page.getByPlaceholder("Item barcode").first().fill("CAM-1");
    await page.getByRole("button", { name: "Return item" }).click();
    await expect.poll(() => actionType).toBe("quick_return");
  });
});
