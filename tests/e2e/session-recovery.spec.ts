import { expect, test, type BrowserContext } from "@playwright/test";
import { navigateApp, waitForPublicAuthBootstrap } from "./helpers/testHarness";

const installSessionRecoveryMocks = async (context: BrowserContext) => {
  let serverSession = false;
  let logoutRequests = 0;

  await context.route(/\/functions(?:\/v1)?\/system-status(?:\?.*)?$/, async (route) => {
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

  await context.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(serverSession ? {
        user: { id: "better-auth-recovery", email: "admin@example.com", name: "Admin", emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        session: { id: "session-recovery", userId: "better-auth-recovery", token: "token", expiresAt: new Date(Date.now()+3600000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      } : null),
    });
  });

  await context.route("**/api/auth/sign-out", async (route) => {
    logoutRequests += 1;
    serverSession = false;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await context.route("**/rest/v1/profiles?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "user-session-recovery", role: "workspace_admin", workspace_id: "tenant-e2e", auth_email: "admin@example.com", is_active: true }]) });
  });

  await context.route("**/rest/v1/workspaces?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "tenant-e2e", status: "active", slug: "tenant-e2e" }]),
    });
  });

  await context.route(/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/, async (route) => {
    const body = (route.request().postDataJSON() as { action?: string }) ?? {};
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: body.action === "validate_session" ? { valid: false } : { ok: true },
      }),
    });
  });

  return {
    setServerSession: () => {
      serverSession = true;
    },
    getLogoutRequests: () => logoutRequests,
  };
};

test("session-ended recovery clears the server session before a new tab bootstraps", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const mocks = await installSessionRecoveryMocks(context);

  await page.goto("/");
  await waitForPublicAuthBootstrap(page);
  await page.evaluate(() => {
    window.__itemtraxxTest?.setWorkspaceAdminSession("tenant-e2e");
  });
  mocks.setServerSession();
  await navigateApp(page, "/admin");
  await expect(page.getByRole("heading", { name: "This session has been terminated or expired." })).toBeVisible();

  await page.getByRole("button", { name: "Sign in again" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(mocks.getLogoutRequests()).toBe(1);

  const freshTab = await context.newPage();
  await freshTab.goto("/");
  await waitForPublicAuthBootstrap(freshTab);
  await expect(freshTab).toHaveURL(/\/$/);
  await expect(
    freshTab.getByRole("alertdialog").filter({ hasText: "Session Ended" }),
  ).toHaveCount(0);

  await context.close();
});
