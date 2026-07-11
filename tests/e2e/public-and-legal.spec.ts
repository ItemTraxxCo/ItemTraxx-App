import { expect, test } from "@playwright/test";
import { mockSystemStatus } from "./helpers/testHarness";

test.describe("Public surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
  });

  test("loads landing page with primary sections", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "ItemTraxx", exact: true })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Login", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Answers to the common stuff." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Get started with ItemTraxx and advance your inventory management." })).toBeVisible();
  });

  test("loads public status without contacting Supabase directly", async ({ page }) => {
    const requestedUrls: string[] = [];
    page.on("request", (request) => requestedUrls.push(request.url()));

    await page.goto("/");
    await expect(page.getByRole("link", { name: "Open system status page" })).toContainText("Running");

    expect(requestedUrls.filter((url) => url.includes("/functions/system-status"))).toHaveLength(1);
    expect(requestedUrls.some((url) => /\.supabase\.(?:co|in)\//.test(url))).toBe(false);
  });

  test("loads unified legal agreement page", async ({ page }) => {
    await page.goto("/legal");
    await expect(
      page.getByRole("heading", {
        name: "ItemTraxx Subscription Agreement and Policies",
      }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "11. Billing and Subscription Terms" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "13. Indemnification" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "14. Force Majeure" })).toBeVisible();
  });
});
