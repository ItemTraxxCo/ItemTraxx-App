import { expect, test, type Page } from "@playwright/test";
import {
  mockSuperAdminMutate,
  mockSuperDashboard,
  mockSuperGearMutate,
  mockSuperLogsQuery,
  mockSuperStudentMutate,
  mockSuperTenantMutate,
  mockSystemStatus,
  mockUnauthenticatedSession,
  navigateApp,
  setSuperAdminSession,
} from "./helpers/testHarness";

type SuperOpsRequest = {
  action: string;
  payload: Record<string, unknown>;
};

const captureSuperOpsRequests = async (page: Page) => {
  const requests: SuperOpsRequest[] = [];
  await page.route(/\/functions(?:\/v1)?\/super-ops(?:\?.*)?$/, async (route) => {
    const request = route.request().postDataJSON() as SuperOpsRequest;
    requests.push(request);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data:
          request.action === "list_sessions"
            ? {
                sessions: [
                  {
                    id: "session-e2e",
                    device_id: "device-e2e",
                    device_label: "Test device",
                    user_agent: "Playwright",
                    login_method: "password",
                    login_location: "super_settings",
                    general_location: "Test Lab",
                    created_at: "2026-07-13T00:00:00.000Z",
                    last_seen_at: "2026-07-13T00:01:00.000Z",
                    is_current: true,
                  },
                ],
              }
            : {},
      }),
    });
  });
  return requests;
};

test.describe("Super admin flows and export actions", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
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
    await expect(page.getByRole("heading", { name: "Admin Management" })).toBeVisible();
    await expect(
      page.getByText("Manage tenant and district/organization admins from one place, with scope-aware filters and actions."),
    ).toBeVisible();

    await navigateApp(page, "/super-admin/gear");
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export PDF" })).toBeVisible();

    await navigateApp(page, "/super-admin/borrowers");
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export PDF" })).toBeVisible();

    await navigateApp(page, "/super-admin/logs");
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export PDF" })).toBeVisible();
  });

  test("super-admin top navigation preserves role actions and system status", async ({ page }) => {
    await page.goto("/");
    await setSuperAdminSession(page);
    await navigateApp(page, "/super-admin");

    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("menuitem", { name: "Open Admin Panel" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Log Out User" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /System Status: Running/ })).toHaveAttribute(
      "href",
      "https://status.itemtraxx.com/?ref=trmenu",
    );
  });

  test("control-center actions preserve their exact request envelopes", async ({ page }) => {
    const requests = await captureSuperOpsRequests(page);
    await page.goto("/");

    await page.evaluate(async () => {
      const controlCenter = await import("/src/services/superOps/controlCenter.ts");
      await controlCenter.getControlCenter();
      await controlCenter.setRuntimeConfig({
        key: "maintenance",
        value: { enabled: true, message: "Scheduled maintenance" },
      });
      await controlCenter.upsertAlertRule({
        id: "alert-e2e",
        name: "Overdue items",
        metric_key: "overdue_items",
        threshold: 5,
        is_enabled: true,
      });
      await controlCenter.forceTenantReauth({ tenant_id: "tenant-e2e" });
      await controlCenter.setTenantPolicy({
        tenant_id: "tenant-e2e",
        checkout_due_hours: 48,
        feature_flags: {
          enable_notifications: true,
          enable_bulk_item_import: false,
          enable_bulk_student_tools: true,
          enable_status_tracking: false,
          enable_barcode_generator: true,
        },
      });
      await controlCenter.approveRequest({ id: "approval-e2e" });
    });

    expect(requests).toEqual([
      { action: "get_control_center", payload: {} },
      {
        action: "set_runtime_config",
        payload: {
          key: "maintenance",
          value: { enabled: true, message: "Scheduled maintenance" },
        },
      },
      {
        action: "upsert_alert_rule",
        payload: {
          id: "alert-e2e",
          name: "Overdue items",
          metric_key: "overdue_items",
          threshold: 5,
          is_enabled: true,
        },
      },
      { action: "set_tenant_force_reauth", payload: { tenant_id: "tenant-e2e" } },
      {
        action: "set_tenant_policy",
        payload: {
          tenant_id: "tenant-e2e",
          checkout_due_hours: 48,
          feature_flags: {
            enable_notifications: true,
            enable_bulk_item_import: false,
            enable_bulk_student_tools: true,
            enable_status_tracking: false,
            enable_barcode_generator: true,
          },
        },
      },
      { action: "approve_request", payload: { id: "approval-e2e" } },
    ]);
  });

  test("support actions preserve their exact request envelopes", async ({ page }) => {
    const requests = await captureSuperOpsRequests(page);
    await page.goto("/");

    await page.evaluate(async () => {
      const support = await import("/src/services/superOps/support.ts");
      await support.listSupportRequests();
      await support.getSupportRequest({ support_request_id: "support-e2e" });
      await support.updateSupportRequest({
        support_request_id: "support-e2e",
        status: "in_progress",
        internal_notes: "Investigating",
        assign_to_me: true,
        clear_assignment: false,
      });
    });

    expect(requests).toEqual([
      { action: "list_support_requests", payload: {} },
      { action: "get_support_request", payload: { support_request_id: "support-e2e" } },
      {
        action: "update_support_request",
        payload: {
          support_request_id: "support-e2e",
          status: "in_progress",
          internal_notes: "Investigating",
          assign_to_me: true,
          clear_assignment: false,
        },
      },
    ]);
  });

  test("sales and customer actions preserve their exact request envelopes", async ({ page }) => {
    const requests = await captureSuperOpsRequests(page);
    await page.goto("/");

    await page.evaluate(async () => {
      const salesCustomers = await import("/src/services/superOps/salesCustomers.ts");
      await salesCustomers.listSalesLeads();
      await salesCustomers.setSalesLeadStage({
        lead_id: "lead-e2e",
        stage: "quote_converted_to_invoice",
      });
      await salesCustomers.closeSalesLead({ lead_id: "lead-e2e" });
      await salesCustomers.moveSalesLeadToCustomer({ lead_id: "lead-e2e" });
      await salesCustomers.listCustomers({ search: "Acme", limit: 200 });
      await salesCustomers.addCustomerStatusEntry({
        lead_id: "lead-e2e",
        invoice_id: "invoice-e2e",
        status: "awaiting_payment",
      });
    });

    expect(requests).toEqual([
      { action: "list_sales_leads", payload: {} },
      {
        action: "set_sales_lead_stage",
        payload: { lead_id: "lead-e2e", stage: "quote_converted_to_invoice" },
      },
      { action: "close_sales_lead", payload: { lead_id: "lead-e2e" } },
      { action: "move_sales_lead_to_customer", payload: { lead_id: "lead-e2e" } },
      { action: "list_customers", payload: { search: "Acme", limit: 200 } },
      {
        action: "add_customer_status_entry",
        payload: {
          lead_id: "lead-e2e",
          invoice_id: "invoice-e2e",
          status: "awaiting_payment",
        },
      },
    ]);
  });

  test("internal snapshot action preserves its exact request envelope", async ({ page }) => {
    const requests = await captureSuperOpsRequests(page);
    await page.goto("/");

    await page.evaluate(async () => {
      const internalOps = await import("/src/services/superOps/internalOps.ts");
      await internalOps.getInternalOpsSnapshot();
    });

    expect(requests).toEqual([{ action: "get_internal_ops_snapshot", payload: {} }]);
  });

  test("session actions preserve device and default payload transformations", async ({ page }) => {
    const requests = await captureSuperOpsRequests(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("itemtraxx-device-id", "device-e2e");
      localStorage.setItem("itemtraxx-device-label", "Test device");
    });

    const sessions = await page.evaluate(async () => {
      const sessionOps = await import("/src/services/superOps/sessions.ts");
      await sessionOps.touchSuperAdminSession();
      await sessionOps.touchSuperAdminSession({
        loginMethod: "passkey",
        loginLocation: "super_settings",
      });
      const listed = await sessionOps.listSuperAdminSessions();
      await sessionOps.revokeSuperAdminSession("session-e2e");
      await sessionOps.revokeAllSuperAdminSessions();
      return listed;
    });

    expect(sessions).toEqual([
      expect.objectContaining({ id: "session-e2e", device_id: "device-e2e", is_current: true }),
    ]);
    expect(requests).toEqual([
      {
        action: "touch_session",
        payload: {
          device_id: "device-e2e",
          device_label: "Test device",
          login_method: null,
          login_location: null,
        },
      },
      {
        action: "touch_session",
        payload: {
          device_id: "device-e2e",
          device_label: "Test device",
          login_method: "passkey",
          login_location: "super_settings",
        },
      },
      {
        action: "list_sessions",
        payload: { device_id: "device-e2e", device_label: "Test device" },
      },
      {
        action: "revoke_session",
        payload: {
          session_id: "session-e2e",
          device_id: "device-e2e",
          device_label: "Test device",
        },
      },
      {
        action: "revoke_all_sessions",
        payload: {
          sign_out_current: false,
          device_id: "device-e2e",
          device_label: "Test device",
        },
      },
    ]);
  });
});
