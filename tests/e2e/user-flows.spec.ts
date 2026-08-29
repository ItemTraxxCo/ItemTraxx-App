import { expect, test, type Page } from "@playwright/test";
import {
  mockAdminOps,
  mockSystemStatus,
  mockUnauthenticatedSession,
  navigateApp,
  setWorkspaceAdminSession,
} from "./helpers/testHarness";

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
      }),
    );
  });
};

const prepareWorkspaceAdminPage = async (page: Page) => {
  await mockSystemStatus(page);
  await mockUnauthenticatedSession(page);
  await mockAdminOps(page);
  await page.goto("/");
  await dismissFirstRunSurfaces(page);
  await setWorkspaceAdminSession(page);
};

test.describe("core user flows", () => {
  test("tenant account sign-in lands on the checkout workflow", async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
    await page.goto("/");
    await dismissFirstRunSurfaces(page);

    const loginRequests: Array<Record<string, unknown>> = [];
    await page.route(/\/functions(?:\/v1)?\/workspace-login(?:\?.*)?$/, async (route) => {
      loginRequests.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "access-token-e2e",
          refresh_token: "refresh-token-e2e",
          workspace_slug: "",
        }),
      });
    });
    await page.route("**/auth/session/exchange", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: {
            id: "user-e2e-tenant",
            email: "tenant.user@example.com",
            last_sign_in_at: new Date().toISOString(),
          },
          profile: {
            role: "tenant_account",
            workspace_id: "tenant-e2e",
            auth_email: "tenant.user@example.com",
            is_active: true,
          },
        }),
      });
    });
    await page.route(/\/functions(?:\/v1)?\/login-notify(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();

    await page.getByPlaceholder("Email address").fill(" Tenant.User@Example.COM ");
    await page.getByPlaceholder("Enter password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByText("Checkout and return", { exact: true })).toBeVisible();
    expect(loginRequests).toEqual([
      {
        email: "tenant.user@example.com",
        password: "correct horse battery staple",
      },
    ]);
  });

  test("workspace admin sign-in uses the unified login page and lands on admin", async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
    await mockAdminOps(page);
    await page.route("**/rest/v1/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });
    await page.goto("/");
    await dismissFirstRunSurfaces(page);

    await page.route(/\/functions(?:\/v1)?\/workspace-login(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "admin-access-token-e2e",
          refresh_token: "admin-refresh-token-e2e",
          workspace_slug: "",
        }),
      });
    });
    await page.route("**/auth/session/exchange", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: {
            id: "user-e2e-admin",
            email: "tenant.admin@example.com",
            last_sign_in_at: new Date().toISOString(),
          },
          profile: {
            role: "workspace_admin",
            workspace_id: "tenant-e2e",
            auth_email: "tenant.admin@example.com",
            is_active: true,
          },
          password_authenticated_at: new Date().toISOString(),
        }),
      });
    });
    await page.route(/\/functions(?:\/v1)?\/login-notify(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto("/admin/login");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByText("Go to admin sign in", { exact: true })).toHaveCount(0);

    await page.getByPlaceholder("Email address").fill("tenant.admin@example.com");
    await page.getByPlaceholder("Enter password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Workspace Overview", exact: true })).toBeVisible();
  });

  test("workspace admin can add an item and see it in the inventory list", async ({ page }) => {
    const items: Array<Record<string, unknown>> = [];
    const createRequests: Array<Record<string, unknown>> = [];

    await prepareWorkspaceAdminPage(page);
    await page.route("**/rest/v1/**", async (route) => {
      const request = route.request();
      const table = new URL(request.url()).pathname.split("/").at(-1);
      if (request.method() === "GET" && table === "items") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(items) });
        return;
      }
      if (request.method() === "GET" && table === "profiles") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ id: "account-1", auth_email: "desk@demo.test" }]),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    });
    await page.route(/\/functions(?:\/v1)?\/admin-item-mutate(?:\?.*)?$/, async (route) => {
      const body = route.request().postDataJSON() as {
        action?: string;
        payload?: Record<string, unknown>;
      };
      if (body.action === "list_deleted") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) });
        return;
      }
      if (body.action === "create") {
        const payload = body.payload ?? {};
        createRequests.push(payload);
        const created = {
          id: "item-created",
          workspace_id: "tenant-e2e",
          name: payload.name,
          barcode: payload.barcode,
          serial_number: payload.serial_number,
          status: payload.status,
          notes: payload.notes,
          access_mode: payload.access_mode,
        };
        items.unshift(created);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: created }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
    });

    await navigateApp(page, "/admin/items");
    await expect(page.getByRole("heading", { name: "Item Management", exact: true })).toBeVisible();
    await page.getByPlaceholder("Item name").fill("Camera A");
    await page.getByPlaceholder("Barcode", { exact: true }).fill("CAM-001");
    await page.getByPlaceholder("Serial number").fill("SN-001");
    await page.getByPlaceholder("Optional notes").fill("Front desk camera");
    await page.getByRole("button", { name: "All Tenant Accounts", exact: true }).click();
    await page.getByRole("button", { name: "Add item", exact: true }).click();

    await expect(page.getByText("Item added.", { exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Camera A", exact: true })).toBeVisible();
    expect(createRequests).toHaveLength(1);
    expect(createRequests[0]).toMatchObject({
      workspace_id: "tenant-e2e",
      name: "Camera A",
      barcode: "CAM-001",
      serial_number: "SN-001",
      status: "available",
      notes: "Front desk camera",
      access_mode: "all",
      profile_ids: [],
    });
    expect(createRequests[0].device_id).toEqual(expect.any(String));
  });

  test("workspace admin can add a borrower and see it in the borrower list", async ({ page }) => {
    const borrowers: Array<Record<string, unknown>> = [];
    const createRequests: Array<Record<string, unknown>> = [];

    await prepareWorkspaceAdminPage(page);
    await page.route("**/rest/v1/**", async (route) => {
      const request = route.request();
      const table = new URL(request.url()).pathname.split("/").at(-1);
      if (request.method() === "GET" && table === "borrowers") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(borrowers) });
        return;
      }
      if (request.method() === "GET" && table === "profiles") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([{ id: "account-1", auth_email: "desk@demo.test" }]),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    });
    await page.route(/\/functions(?:\/v1)?\/admin-borrower-mutate(?:\?.*)?$/, async (route) => {
      const body = route.request().postDataJSON() as {
        action?: string;
        payload?: Record<string, unknown>;
      };
      if (body.action === "list_deleted") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) });
        return;
      }
      if (body.action === "create") {
        const payload = body.payload ?? {};
        createRequests.push(payload);
        const created = {
          id: "borrower-created",
          workspace_id: "tenant-e2e",
          username: payload.username,
          borrower_id: payload.borrower_id,
          access_mode: payload.access_mode,
        };
        borrowers.unshift(created);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: created }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
    });

    await navigateApp(page, "/admin/borrowers");
    await expect(page.getByRole("heading", { name: "Borrower Management", exact: true })).toBeVisible();
    const username = await page.locator('input[readonly]').first().inputValue();
    const borrowerId = await page.locator('input[readonly]').nth(1).inputValue();
    expect(username).toMatch(/^[A-Za-z]+[A-Za-z]+\d+$/);
    expect(borrowerId).toMatch(/^[A-Z0-9]+$/);
    await page.getByRole("button", { name: "All Tenant Accounts", exact: true }).click();
    await page.getByRole("button", { name: "Add borrower", exact: true }).click();

    await expect(page.getByText("Borrower added.", { exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: username, exact: true })).toBeVisible();
    expect(createRequests).toHaveLength(1);
    expect(createRequests[0]).toMatchObject({
      workspace_id: "tenant-e2e",
      username,
      borrower_id: borrowerId,
      access_mode: "all",
      profile_ids: [],
    });
    expect(createRequests[0].device_id).toEqual(expect.any(String));
  });
});
