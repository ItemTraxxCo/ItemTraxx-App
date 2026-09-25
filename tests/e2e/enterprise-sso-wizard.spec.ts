import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  mockAdminOps,
  mockSuperDashboard,
  mockSystemStatus,
  mockUnauthenticatedSession,
  navigateApp,
  setWorkspaceAdminSession,
} from "./helpers/testHarness";

type Registration = {
  providerId: string;
  domain: string;
  issuer: string;
  samlConfig?: { entryPoint: string; cert: string };
  oidcConfig?: { discoveryEndpoint: string; clientId: string; clientSecret: string };
};

const openSsoSetup = async (page: Page) => {
  let registration: Registration | undefined;
  await page.addInitScript(() => {
    try {
      const completedAt = new Date().toISOString();
      localStorage.setItem("itemtraxx:onboarding:v1:tenant_account", completedAt);
      localStorage.setItem("itemtraxx:onboarding:v1:workspace_admin", completedAt);
      localStorage.setItem("itemtraxx-cookie-consent", JSON.stringify({
        version: 2,
        preferences: { analytics: false, diagnostics: false },
        updatedAt: completedAt,
      }));
    } catch {
      // The initial about:blank document does not have storage access.
    }
  });
  await mockSystemStatus(page);
  await mockUnauthenticatedSession(page);
  await mockAdminOps(page);
  await mockSuperDashboard(page);
  await page.route(/\/functions(?:\/v1)?\/consent-record(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: { recorded: true } }),
  }));
  await page.route("https://kv.better-auth.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({}),
  }));
  await page.route("**/rest/v1/rpc/resolve_public_workspace_by_id**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([]),
  }));
  await page.goto("/");
  await setWorkspaceAdminSession(page, "workspace-sso-wizard");

  await page.route("**/api/itemtraxx/sso/providers**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        organizationId: "workspace-sso-wizard",
        providers: registration ? [{
          providerId: registration.providerId,
          domain: registration.domain,
          domainVerified: false,
          organizationId: "workspace-sso-wizard",
          samlConfig: registration.samlConfig ?? null,
          oidcConfig: registration.oidcConfig ?? null,
        }] : [],
      }),
    });
  });
  await page.route("**/api/auth/sso/register", async (route) => {
    registration = route.request().postDataJSON() as Registration;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ domainVerificationToken: "fake-dns-verification-token" }),
    });
  });

  await navigateApp(page, "/admin/settings/sso");
  await expect(page.getByRole("heading", { name: "Connect an identity provider" })).toBeVisible();
  return () => registration;
};

const capture = async (page: Page, fileName: string) => {
  const outputDirectory = process.env.SSO_WIZARD_SCREENSHOT_DIR;
  if (!outputDirectory) return;
  await mkdir(outputDirectory, { recursive: true });
  await page.screenshot({ path: join(outputDirectory, fileName), fullPage: true, animations: "disabled" });
};

test.describe("Enterprise SSO guided setup", () => {
  test("walks through SAML, reviews values, creates the connection, and shows next steps", async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(`${message.text()} ${JSON.stringify(message.location())}`);
    });
    page.on("requestfailed", (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ""}`));

    const getRegistration = await openSsoSetup(page);
    await capture(page, "saml-01-protocol.png");
    await expect(page.getByText("Step 1 of 7")).toBeVisible();

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Name this connection" })).toBeVisible();
    const providerIdField = page.getByLabel("Provider ID");
    await expect(providerIdField).toHaveAttribute("pattern", "[a-z0-9\\-]+");
    await providerIdField.fill("Acme Demo");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toHaveText("Use lowercase letters, numbers, and hyphens only (for example, acme-sso). Remove spaces or underscores.");
    await expect(providerIdField).toHaveAttribute("aria-invalid", "true");
    const errorColors = await Promise.all([
      providerIdField.evaluate((element) => getComputedStyle(element).borderTopColor),
      page.getByRole("alert").evaluate((element) => getComputedStyle(element).color),
    ]);
    expect(errorColors[0]).toBe(errorColors[1]);
    await providerIdField.fill("acme-sso");
    await capture(page, "saml-02-provider-id.png");
    await page.getByRole("button", { name: "Continue" }).click();

    const emailDomainField = page.getByLabel("Verified email domain");
    await emailDomainField.fill("@example.edu");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toHaveText("Enter only the email domain, such as example.edu. Remove the @, https://, or any path.");
    await emailDomainField.fill("example.edu");
    await capture(page, "saml-03-email-domain.png");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Identity provider issuer / entity ID").fill("https://idp.example.com/saml/issuer");
    await capture(page, "saml-04-issuer.png");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("IdP SSO URL").fill("https://idp.example.com/saml/sso");
    await capture(page, "saml-05-sso-url.png");
    await page.getByRole("button", { name: "Continue" }).click();

    const fakeCertificateBody = "VEVTVENFUlRJRklDQVRF".repeat(8);
    await page.getByLabel("IdP signing certificate").fill(`-----BEGIN CERTIFICATE-----\n${fakeCertificateBody}\n-----END CERTIFICATE-----`);
    await capture(page, "saml-06-certificate.png");
    await page.getByRole("button", { name: "Review setup" }).click();

    await expect(page.getByRole("heading", { name: "Review your connection" })).toBeVisible();
    await expect(page.getByText("https://idp.example.com/saml/issuer")).toBeVisible();
    await expect(page.getByText("example.edu", { exact: true })).toBeVisible();
    await page.getByText("View signing certificate").click();
    await expect(page.locator(".review-value pre")).toContainText(fakeCertificateBody);
    await page.getByText("View signing certificate").click();
    await capture(page, "saml-07-review-desktop.png");

    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, "saml-08-review-mobile.png");
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(mobileOverflow).toBe(false);
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.getByRole("button", { name: "Change" }).nth(4).click();
    await expect(page.getByLabel("IdP SSO URL")).toHaveValue("https://idp.example.com/saml/sso");
    await page.getByLabel("IdP SSO URL").fill("https://idp.example.com/saml/sso-updated");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Review setup" }).click();
    await expect(page.getByText("https://idp.example.com/saml/sso-updated")).toBeVisible();
    await page.getByRole("button", { name: "Create SSO connection" }).click();

    await expect(page.getByText("Connection created", { exact: true })).toBeVisible();
    await expect(page.getByText("_better-auth-token-acme-sso.example.edu")).toBeVisible();
    await expect(page.getByText("fake-dns-verification-token")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open ItemTraxx SP metadata" })).toHaveAttribute("href", /saml2\/sp\/metadata\?providerId=acme-sso/);
    await expect(page.getByRole("link", { name: "SP metadata", exact: true })).toBeVisible();
    await capture(page, "saml-09-created-desktop.png");

    expect(getRegistration()).toMatchObject({
      providerId: "acme-sso",
      domain: "example.edu",
      issuer: "https://idp.example.com/saml/issuer",
      samlConfig: { entryPoint: "https://idp.example.com/saml/sso-updated" },
    });
    expect(getRegistration()?.samlConfig?.cert).toContain(fakeCertificateBody);
    expect(pageErrors).toEqual([]);
    expect({ consoleErrors, failedRequests }).toEqual({ consoleErrors: [], failedRequests: [] });
  });

  test("walks through OIDC and keeps the client secret masked on review", async ({ page }) => {
    const getRegistration = await openSsoSetup(page);
    await page.getByRole("radio", { name: /OpenID Connect/ }).check();
    await expect(page.getByText("Step 1 of 8")).toBeVisible();
    await capture(page, "oidc-01-protocol.png");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Provider ID").fill("oidc-demo");
    await expect(page.getByText(/api\/auth\/sso\/callback\/oidc-demo/)).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Verified email domain").fill("school.example");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("OIDC issuer URL").fill("https://login.example.com/tenant/v2.0");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("OIDC discovery URL").fill("https://login.example.com/tenant/.well-known/openid-configuration");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Client ID").fill("fake-client-id");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Client secret").fill("fake-client-secret-value");
    await capture(page, "oidc-07-client-secret.png");
    await page.getByRole("button", { name: "Review setup" }).click();

    await expect(page.getByRole("heading", { name: "Review your connection" })).toBeVisible();
    await expect(page.getByText(/api\/auth\/sso\/callback\/oidc-demo/)).toBeVisible();
    await expect(page.getByText("fake-client-secret-value")).toHaveCount(0);
    await expect(page.getByText("••••••••••••")).toBeVisible();
    await capture(page, "oidc-08-review-desktop.png");
    await page.getByRole("button", { name: "Show client secret" }).click();
    await expect(page.getByText("fake-client-secret-value")).toBeVisible();
    await page.getByRole("button", { name: "Hide client secret" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await capture(page, "oidc-09-review-mobile.png");
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.getByRole("button", { name: "Create SSO connection" }).click();
    await expect(page.getByText("Connection created", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open ItemTraxx SP metadata" })).toHaveCount(0);
    expect(getRegistration()).toMatchObject({
      providerId: "oidc-demo",
      domain: "school.example",
      issuer: "https://login.example.com/tenant/v2.0",
      oidcConfig: {
        discoveryEndpoint: "https://login.example.com/tenant/.well-known/openid-configuration",
        clientId: "fake-client-id",
        clientSecret: "fake-client-secret-value",
      },
    });
  });
});
