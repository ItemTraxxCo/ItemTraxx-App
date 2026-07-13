import { expect, test } from "@playwright/test";
import { mockSystemStatus, mockUnauthenticatedSession } from "./helpers/testHarness";

test.describe("Public contact forms", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
  });

  test("contact sales submits the expected edge payload and shows confirmation", async ({ page }) => {
    let capturedPayload: Record<string, unknown> | null = null;

    await page.route(/\/functions(?:\/v1)?\/contact-sales-submit(?:\?.*)?$/, async (route) => {
      capturedPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { lead_id: "lead-e2e-1" } }),
      });
    });

    await page.goto("/contact-sales");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Taylor Smith");
    await page.getByLabel("Reply email address").fill("taylor@example.edu");
    await page.getByLabel("Please Select Plan").selectOption("organization_starter");
    await page
      .getByLabel("School, district or organization name (leave blank for individual plans)")
      .fill("Example School");
    await page.getByLabel("Additional information").fill("We need help evaluating ItemTraxx.");
    await page.getByRole("button", { name: "Submit Sales Request" }).click();

    await expect(page.getByRole("heading", { name: "Thanks for reaching out." })).toBeVisible();
    await expect(page).toHaveURL(/\/submitconfirmation$/);
    expect(capturedPayload).toMatchObject({
      plan: "organization_starter",
      name: "Taylor Smith",
      organization: "Example School",
      reply_email: "taylor@example.edu",
      details: "We need help evaluating ItemTraxx.",
      intent: "sales",
      turnstile_token: "",
      website: "",
    });
  });

  test("contact support submits the expected edge payload and shows confirmation", async ({ page }) => {
    let capturedPayload: Record<string, unknown> | null = null;

    await page.route(/\/functions(?:\/v1)?\/contact-support-submit(?:\?.*)?$/, async (route) => {
      capturedPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { accepted: true, request_id: "support-e2e-1" } }),
      });
    });

    await page.goto("/contact-support");
    await page.getByLabel("Name").fill("Jordan Lee");
    await page.getByLabel("Reply email address").fill("jordan@example.edu");
    await page.getByLabel("Category").selectOption("bug");
    await page.getByLabel("Subject").fill("Checkout issue");
    await page.getByLabel("Message").fill("The checkout page showed an unexpected error.");
    await page.getByRole("button", { name: "Submit Support Request" }).click();

    await expect(page.getByRole("heading", { name: "Thanks for reaching out." })).toBeVisible();
    await expect(page).toHaveURL(/\/submitconfirmation$/);
    expect(capturedPayload).toMatchObject({
      name: "Jordan Lee",
      reply_email: "jordan@example.edu",
      category: "bug",
      subject: "Checkout issue",
      message: "The checkout page showed an unexpected error.",
      turnstile_token: "",
      website: "",
      attachments: [],
    });
  });
});
