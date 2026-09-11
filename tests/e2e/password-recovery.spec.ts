import { expect, test, type Page } from "@playwright/test";
import { mockUnauthenticatedSession, navigateApp, waitForPublicAuthBootstrap } from "./helpers/testHarness";

const openPublicShell = async (page: Page) => {
  await mockUnauthenticatedSession(page);
  await page.goto("/");
  await waitForPublicAuthBootstrap(page);
};

test.describe("Better Auth password recovery", () => {
  test("forgot-password normalizes email and sends the exact reset redirect", async ({ page }) => {
    await openPublicShell(page);
    let requestBody: Record<string, unknown> | null = null;
    await page.route("**/api/auth/request-password-reset", async (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: true }) });
    });
    await navigateApp(page, "/forgot-password");
    await page.getByLabel("Account Email").fill("  Person.Name@Example.COM  ");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/Password reset link sent/)).toBeVisible();
    expect(requestBody).toEqual({
      email: "person.name@example.com",
      redirectTo: `${new URL(page.url()).origin}/reset-password`,
    });
  });

  test("forgot-password maps a Better Auth failure to a safe rendered error", async ({ page }) => {
    await openPublicShell(page);
    await page.route("**/api/auth/request-password-reset", (route) => route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ code: "RATE_LIMITED", message: "rate limit exceeded" }),
    }));
    await navigateApp(page, "/forgot-password");
    await page.getByLabel("Account Email").fill("person@example.com");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("Unable to send reset link. Please try again.")).toBeVisible();
  });

  test("reset-password submits a valid Better Auth recovery token", async ({ page }) => {
    await openPublicShell(page);
    let requestBody: Record<string, unknown> | null = null;
    await page.route("**/api/auth/reset-password", async (route) => {
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: true }) });
    });
    await navigateApp(page, "/reset-password?token=recovery-token");
    await page.getByLabel("New Password", { exact: true }).fill("New-password-123!");
    await page.getByLabel("Confirm Password").fill("New-password-123!");
    await page.getByRole("button", { name: "Update Password" }).click();
    await expect(page.getByText(/Password successfully updated/)).toBeVisible();
    expect(requestBody).toEqual({ newPassword: "New-password-123!", token: "recovery-token" });
  });

  test("reset-password rejects a weak password before any request", async ({ page }) => {
    await openPublicShell(page);
    let requests = 0;
    await page.route("**/api/auth/reset-password", async (route) => { requests += 1; await route.abort(); });
    await navigateApp(page, "/reset-password?token=recovery-token");
    await page.getByLabel("New Password", { exact: true }).fill("alllowercasepassword");
    await page.getByLabel("Confirm Password").fill("alllowercasepassword");
    await page.getByRole("button", { name: "Update Password" }).click();
    await expect(page.getByText(/Password must be at least 12 characters/)).toBeVisible();
    expect(requests).toBe(0);
  });
});
