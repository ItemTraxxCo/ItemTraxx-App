import type { Page } from "@playwright/test";

export const mockSystemStatus = async (page: Page) => {
  await page.route(/\/functions(?:\/v1)?\/system-status(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "operational",
        checks: { config: "ok", db: "ok", incident_io: "ok" },
        incident_summary: "All systems operational.",
        checked_at: new Date().toISOString(),
        maintenance: { enabled: false, message: "" },
      }),
    });
  });
};

export const mockAdminOps = async (page: Page) => {
  await page.route(/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.fulfill({
        status: 405,
        contentType: "application/json",
        body: JSON.stringify({ error: "Method not allowed" }),
      });
      return;
    }
    const body = request.postDataJSON() as
      | { action?: string }
      | undefined;
    const action = body?.action || "";

    if (action === "get_tenant_settings") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            checkout_due_hours: 48,
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

    if (action === "get_status_tracking") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            flagged_items: [],
            history: [],
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: {} }),
    });
  });
};

export const mockSuperDashboard = async (page: Page) => {
  await page.route(/\/functions(?:\/v1)?\/super-dashboard(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          totals: {
            tenants: 12,
            active_tenants: 11,
            suspended_tenants: 1,
            tenant_admins: 14,
          },
          alerts: [],
          approvals: [],
          tenant_activity: [],
          recent_actions: [],
          jobs: [],
        },
      }),
    });
  });
};

export const setTenantAdminSession = async (page: Page, tenantId = "tenant-e2e") => {
  await page.waitForFunction(() => typeof window.__itemtraxxTest?.setTenantAdminSession === "function");
  await page.evaluate((id) => {
    window.__itemtraxxTest?.setTenantAdminSession(id);
  }, tenantId);
};

export const setSuperAdminSession = async (page: Page) => {
  await page.waitForFunction(() => typeof window.__itemtraxxTest?.setSuperAdminSession === "function");
  await page.evaluate(() => {
    window.__itemtraxxTest?.setSuperAdminSession();
  });
};

export const navigateApp = async (page: Page, path: string) => {
  await page.waitForFunction(() => typeof window.__itemtraxxTest?.navigate === "function");
  await page.evaluate(async (to) => {
    await window.__itemtraxxTest?.navigate(to);
  }, path);
};
