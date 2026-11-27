import { expect, test, type Page } from "@playwright/test";
import {
  mockAdminOps,
  mockSuperDashboard,
  mockSystemStatus,
  mockUnauthenticatedSession,
  navigateApp,
  seedCookieConsent,
  setWorkspaceAdminSession,
} from "./helpers/testHarness";

const ADMIN_OPS_ROUTE = /\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/;

const featureFlags = {
  enable_notifications: true,
  enable_bulk_item_import: true,
  enable_bulk_borrower_tools: true,
  enable_status_tracking: true,
  enable_barcode_generator: true,
};

const recentStatusEvents = [
  {
    id: "history-1",
    item_id: "item-projector",
    status: "in_repair",
    note: null,
    changed_at: "2026-11-20T10:00:00.000Z",
    changed_by: null,
    item: { name: "Projector", barcode: "PRJ-1" },
  },
];

const notificationsPayload = {
  overdue_count: 0,
  flagged_count: 2,
  checkout_due_hours: 72,
  updates: [],
  feature_flags: featureFlags,
  recent_status_events: recentStatusEvents,
};

const statusTrackingPayload = {
  flagged_items: [
    {
      id: "item-camera",
      name: "Camera",
      barcode: "CAM-1",
      serial_number: null,
      status: "damaged",
      notes: null,
      updated_at: "2026-11-19T10:00:00.000Z",
    },
    {
      id: "item-projector",
      name: "Projector",
      barcode: "PRJ-1",
      serial_number: null,
      status: "in_repair",
      notes: null,
      updated_at: "2026-11-20T10:00:00.000Z",
    },
  ],
  history: recentStatusEvents,
};

const mockNotificationActions = async (page: Page, options: { failNotifications?: boolean } = {}) => {
  const control = { failNotifications: options.failNotifications ?? false };
  await page.route(ADMIN_OPS_ROUTE, async (route) => {
    const body = route.request().postDataJSON() as { action?: string } | undefined;
    if (body?.action === "get_notifications") {
      if (control.failNotifications) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Unable to load notifications." }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: notificationsPayload }),
      });
      return;
    }
    if (body?.action === "get_status_tracking") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: statusTrackingPayload }),
      });
      return;
    }
    await route.fallback();
  });
  return control;
};

const openAdminWithBell = async (page: Page) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.setItem("itemtraxx:onboarding:v1:workspace_admin", new Date().toISOString());
  });
  await setWorkspaceAdminSession(page);
  await navigateApp(page, "/admin");
  await expect(page.getByRole("heading", { name: "Workspace Overview", exact: true })).toBeVisible();
};

test.describe("Workspace admin notification bell", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await seedCookieConsent(page, baseURL, { analytics: false, diagnostics: false });
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
    await mockAdminOps(page);
    await mockSuperDashboard(page);
  });

  test("a status event opens Item Status Tracking with that item highlighted", async ({ page }) => {
    await mockNotificationActions(page);
    await openAdminWithBell(page);

    await page.getByRole("button", { name: /^Notifications/ }).click();
    const panel = page.getByRole("dialog", { name: "Workspace notifications" });
    await panel.getByRole("link", { name: "Projector marked in repair." }).click();

    await expect(page).toHaveURL(/\/admin\/item-status\?item=item-projector$/);
    await expect(panel).toHaveCount(0);
    await expect(page.getByText("Showing Projector.")).toBeVisible();
    await expect(page.locator("tr.row-focused", { hasText: "PRJ-1" }).first()).toBeVisible();
    await expect(page.locator("tr.row-focused", { hasText: "CAM-1" })).toHaveCount(0);

    await page.getByRole("link", { name: "Show all items" }).click();
    await expect(page).toHaveURL(/\/admin\/item-status$/);
    await expect(page.locator("tr.row-focused")).toHaveCount(0);
  });

  test("the item highlight fades out after 4 seconds and drops ?item from the URL", async ({ page }) => {
    await mockNotificationActions(page);
    await openAdminWithBell(page);

    await page.getByRole("button", { name: /^Notifications/ }).click();
    await page.getByRole("link", { name: "Projector marked in repair." }).click();
    await expect(page).toHaveURL(/\/admin\/item-status\?item=item-projector$/);
    const highlighted = page.locator("tr.row-focused", { hasText: "PRJ-1" }).first();
    await expect(highlighted).toBeVisible();

    // Still highlighted shortly before the 4s mark.
    await page.waitForTimeout(3000);
    await expect(highlighted).toBeVisible();
    await expect(page.locator("tr.row-fading")).toHaveCount(0);

    await expect(page.locator("tr.row-focused")).toHaveCount(0, { timeout: 4000 });
    await expect(page).toHaveURL(/\/admin\/item-status$/);
    await expect(page.getByText("Showing Projector.")).toHaveCount(0);
  });

  test("the follow-up summary opens Item Status Tracking", async ({ page }) => {
    await mockNotificationActions(page);
    await openAdminWithBell(page);

    await page.getByRole("button", { name: /^Notifications/ }).click();
    await page.getByRole("link", { name: "2 items need status follow-up." }).click();

    await expect(page).toHaveURL(/\/admin\/item-status$/);
    await expect(page.getByRole("heading", { name: "Item Status Tracking" })).toBeVisible();
  });

  test("a failed load offers Retry and recovers", async ({ page }) => {
    const control = await mockNotificationActions(page, { failNotifications: true });
    await openAdminWithBell(page);

    await page.getByRole("button", { name: /^Notifications/ }).click();
    const panel = page.getByRole("dialog", { name: "Workspace notifications" });
    const retry = panel.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    await expect(panel.getByText("Unable to load notifications.")).toBeVisible();

    control.failNotifications = false;
    await retry.click();
    await expect(panel.getByRole("link", { name: "Projector marked in repair." })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Retry" })).toHaveCount(0);
  });
});
