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

export const mockSuperTenantMutate = async (page: Page) => {
  await page.route(/\/functions(?:\/v1)?\/super-tenant-mutate(?:\?.*)?$/, async (route) => {
    const body = (route.request().postDataJSON() as { action?: string }) ?? {};
    if (body.action === "list_tenants") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: [
            {
              id: "tenant-1",
              name: "Demo Tenant",
              access_code: "DEMO1",
              status: "active",
              created_at: new Date().toISOString(),
              primary_admin_email: "admin@demo.test",
            },
          ],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: {} }),
    });
  });
};

export const mockSuperAdminMutate = async (page: Page) => {
  await page.route(/\/functions(?:\/v1)?\/super-admin-mutate(?:\?.*)?$/, async (route) => {
    const body = (route.request().postDataJSON() as { action?: string }) ?? {};
    if (body.action === "list_tenant_admins") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: [
            {
              id: "admin-1",
              tenant_id: "tenant-1",
              auth_email: "admin@demo.test",
              role: "tenant_admin",
              is_active: true,
              created_at: new Date().toISOString(),
              tenant_name: "Demo Tenant",
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: {} }),
    });
  });
};

export const mockSuperGearMutate = async (page: Page) => {
  await page.route(/\/functions(?:\/v1)?\/super-gear-mutate(?:\?.*)?$/, async (route) => {
    const body = (route.request().postDataJSON() as { action?: string }) ?? {};
    if (body.action === "list") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "gear-1",
              tenant_id: "tenant-1",
              name: "Camera A",
              barcode: "111",
              serial_number: "SN-111",
              status: "available",
              notes: null,
            },
          ],
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

export const mockSuperStudentMutate = async (page: Page) => {
  await page.route(/\/functions(?:\/v1)?\/super-student-mutate(?:\?.*)?$/, async (route) => {
    const body = (route.request().postDataJSON() as { action?: string }) ?? {};
    if (body.action === "list") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "student-1",
              tenant_id: "tenant-1",
              username: "BlueFalcon12",
              student_id: "1234AB",
              created_at: new Date().toISOString(),
            },
          ],
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

export const mockSuperLogsQuery = async (page: Page) => {
  await page.route(/\/functions(?:\/v1)?\/super-logs-query(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "log-1",
            tenant_id: "tenant-1",
            action_type: "checkout",
            action_time: new Date().toISOString(),
            checked_out_by: "student-1",
            performed_by: "admin-1",
            gear: { id: "gear-1", name: "Camera A", barcode: "111" },
            student: { id: "student-1", username: "BlueFalcon12", student_id: "1234AB" },
            tenant: { id: "tenant-1", name: "Demo Tenant" },
          },
        ],
        page: 1,
        page_size: 50,
        count: 1,
      }),
    });
  });
};

export const mockSuspendedTenantAdminOps = async (page: Page) => {
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
    const body = request.postDataJSON() as { action?: string } | undefined;
    if (body?.action === "update_tenant_settings" || body?.action === "bulk_import_gear") {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "Tenant disabled" }),
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
