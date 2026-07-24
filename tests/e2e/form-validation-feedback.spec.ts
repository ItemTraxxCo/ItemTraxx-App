import { expect, test } from "@playwright/test";

// Regression guard: the public Contact Support and Request a Demo forms must
// give visible feedback when submitted with missing fields, rather than
// silently disabling the submit button.
test.describe("public form submit feedback", () => {
  test("contact support surfaces inline validation on empty submit", async ({ page }) => {
    await page.goto("/contact-support");

    const submit = page.getByRole("button", { name: "Submit Support Request" });
    // Button must be enabled even with empty fields (was silently disabled before).
    await expect(submit).toBeEnabled();

    await submit.click();

    // General error banner appears.
    await expect(page.locator(".error")).toHaveText(
      "Complete required fields and security check."
    );

    // Per-field inline errors appear for every empty required field.
    await expect(page.locator(".field-error")).toContainText([
      "Please enter your name.",
      "Please enter your reply email address.",
      "Please enter a subject.",
      "Please enter a message.",
    ]);

    await page.screenshot({ path: "test-results/contact-support-validation.png", fullPage: true });

    // Filling a field clears its inline error.
    await page.getByPlaceholder("Your full name").fill("Jane Doe");
    await expect(page.locator(".field-error")).not.toContainText(["Please enter your name."]);
  });

  test("request a demo surfaces inline validation on empty submit", async ({ page }) => {
    await page.goto("/request-demo");

    const submit = page.getByRole("button", { name: "Send Demo Request" });
    await expect(submit).toBeEnabled();

    await submit.click();

    await expect(page.locator(".error")).toHaveText(
      "Complete required fields and security check."
    );
    await expect(page.locator(".field-error")).toContainText([
      "Please enter your name.",
      "Please enter your reply email address.",
      "Please enter your school, organization, district, or team.",
    ]);

    await page.screenshot({ path: "test-results/request-demo-validation.png", fullPage: true });
  });
});
