import { expect, test } from "@playwright/test";
import { mockSystemStatus } from "./helpers/testHarness";

test.describe("Public surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
  });

  test("loads landing page with primary sections", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "ItemTraxx", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Login", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Answers to the common stuff." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Get started with ItemTraxx and streamline your inventory management." })).toBeVisible();
  });

  test("loads unified legal agreement page", async ({ page }) => {
    await page.goto("/legal");
    await expect(
      page.getByRole("heading", {
        name: "ItemTraxx Subscription Agreement and Policies",
      }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "9. Billing and Subscription Terms" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "11. Indemnification" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "12. Force Majeure" })).toBeVisible();
  });
});
