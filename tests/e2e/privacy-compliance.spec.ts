import { expect, test } from "@playwright/test";
import { mockSystemStatus, mockUnauthenticatedSession } from "./helpers/testHarness";

test.describe("Privacy and legal controls", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
  });

  test("stores independent analytics and diagnostics preferences", async ({ page }) => {
    await page.goto("/");

    await page.getByLabel("Optional cookie categories").getByLabel("Analytics").check();
    await page.getByRole("button", { name: "Save choices" }).click();

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("itemtraxx-cookie-consent") ?? "null")
    );
    expect(stored).toMatchObject({
      version: 2,
      preferences: { analytics: true, diagnostics: false },
    });
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Cookie preferences" })).toHaveCount(0);
  });

  test("stores essential-only and accept-all choices accurately", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Essential only" }).click();
    await expect.poll(() => page.evaluate(() =>
      JSON.parse(localStorage.getItem("itemtraxx-cookie-consent") ?? "null")?.preferences
    )).toEqual({ analytics: false, diagnostics: false });

    await page.evaluate(() => localStorage.removeItem("itemtraxx-cookie-consent"));
    await page.reload();
    await page.getByRole("button", { name: "Accept all" }).click();
    await expect.poll(() => page.evaluate(() =>
      JSON.parse(localStorage.getItem("itemtraxx-cookie-consent") ?? "null")?.preferences
    )).toEqual({ analytics: true, diagnostics: true });
  });

  test("does not load PostHog or retain its persistence before consent", async ({ page, context }) => {
    await context.addCookies([{
      name: "ph_test_posthog",
      value: "stale",
      url: "http://127.0.0.1:4173/",
    }]);
    const sdkRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("node_modules/.vite/deps/posthog-js")) {
        sdkRequests.push(request.url());
      }
    });

    await page.goto("/");
    await expect(page.getByRole("dialog", { name: "Cookie preferences" })).toBeVisible();
    expect(sdkRequests).toEqual([]);
    await expect.poll(async () =>
      (await context.cookies()).some((cookie) => cookie.name.startsWith("ph_"))
    ).toBe(false);
  });

  test("privacy request route selects the privacy category", async ({ page }) => {
    await page.goto("/privacy-request");

    await expect(page.getByRole("heading", { name: "Privacy Request" })).toBeVisible();
    await expect(page.getByLabel("Category")).toHaveValue("privacy");
  });

  test("legal hub exposes student privacy and DPA documents", async ({ page }) => {
    await page.goto("/legal");
    await expect(page.getByRole("heading", { name: "Legal and Privacy Documents" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Student Privacy Notice/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Data Processing Addendum/ }).first()).toBeVisible();

    await page.goto("/legal/student-privacy");
    await expect(page.getByRole("heading", { name: "Student Privacy Notice", level: 1 })).toBeVisible();

    await page.goto("/legal/dpa");
    await expect(page.getByRole("heading", { name: "ItemTraxx Data Processing Addendum", level: 1 })).toBeVisible();
  });

});
