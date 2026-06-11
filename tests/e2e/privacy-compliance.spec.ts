import { expect, test } from "@playwright/test";
import { mockSystemStatus } from "./helpers/testHarness";

test.describe("Privacy and legal controls", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
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
    await expect(page.getByRole("heading", { name: "ItemTraxx Data Processing Addendum Template", level: 1 })).toBeVisible();
  });

  test("district administrator sign in requires explicit terms acceptance", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/district-handoff(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "District terms acceptance required" }),
      });
    });
    await page.goto("/tenant/admin-login");

    await page.getByPlaceholder("Enter email").fill("admin@example.com");
    await page.getByPlaceholder("Enter password").fill("not-a-real-password");

    const submit = page.getByRole("button", { name: "Sign in" });
    await expect(page.getByLabel(/authorized adult administrator/i)).toHaveCount(0);
    await submit.click();

    const acceptance = page.getByLabel(/authorized adult administrator/i);
    await expect(acceptance).toBeVisible();
    await expect(submit).toBeDisabled();
    await expect(acceptance).toHaveAccessibleName(/school.*authority.*student borrower/i);
    await expect(acceptance).toHaveAccessibleName(/generated.*username.*borrower id/i);
    await acceptance.check();
    await expect(acceptance).toBeChecked();

    if ((await page.getByText(/complete security check to enable sign in/i).count()) === 0) {
      await expect(submit).toBeEnabled();
    } else {
      await expect(submit).toBeDisabled();
    }
  });
});
