import { expect, test, type BrowserContext } from "@playwright/test";
import { navigateApp, waitForPublicAuthBootstrap } from "./helpers/testHarness";

const unauthenticatedSummary = {
  authenticated: false,
  user: null,
  profile: null,
};

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

  await context.route("**/auth/session/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(serverSession
        ? {
            authenticated: true,
            user: {
              id: "user-session-recovery",
              email: "admin@example.com",
              last_sign_in_at: new Date().toISOString(),
            },
            profile: {
              role: "workspace_admin",
              workspace_id: "tenant-e2e",
              auth_email: "admin@example.com",
              is_active: true,
            },
          }
        : unauthenticatedSummary),
    });
  });

  await context.route("**/auth/session/logout", async (route) => {
    logoutRequests += 1;
    serverSession = false;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
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
  // Keep the local Supabase sign-out deterministic; the browser session that
  // must be cleared for this regression is the HttpOnly cookie session.
  await page.evaluate(async () => {
    const { supabase } = await import("/src/services/supabaseClient.ts");
    Object.defineProperty(supabase.auth, "signOut", {
      configurable: true,
      value: async () => ({ error: null }),
    });
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
