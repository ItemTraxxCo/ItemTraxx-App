import { expect, test, type Page } from "@playwright/test";
import {
  mockUnauthenticatedSession,
  navigateApp,
  waitForPublicAuthBootstrap,
} from "./helpers/testHarness";

const openPublicShell = async (page: Page) => {
  await mockUnauthenticatedSession(page);
  await page.goto("/");
  await waitForPublicAuthBootstrap(page);
  const consentDialog = page.getByRole("dialog", { name: "Cookie preferences" });
  if (await consentDialog.isVisible()) {
    await consentDialog.getByRole("button", { name: "Essential only" }).click();
  }
};

test.describe("password recovery", () => {
  test("forgot-password submits a normalized email with the exact reset redirect and renders success", async ({
    page,
  }) => {
    await openPublicShell(page);
    const expectedRedirectTo = `${new URL(page.url()).origin}/reset-password`;
    await page.evaluate(async () => {
      const { supabase } = await import("/src/services/supabaseClient.ts");
      const calls: Array<{ email: string; options: { redirectTo: string } }> = [];
      (window as unknown as { __forgotPasswordCalls: typeof calls }).__forgotPasswordCalls = calls;
      Object.defineProperty(supabase.auth, "resetPasswordForEmail", {
        configurable: true,
        value: async (email: string, options: { redirectTo: string }) => {
          calls.push({ email, options });
          return { data: {}, error: null };
        },
      });
    });

    await navigateApp(page, "/forgot-password");
    await page.getByLabel("Account Email").fill("  Person.Name@Example.COM  ");
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page.getByText("Password reset link sent.")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __forgotPasswordCalls: unknown[] }).__forgotPasswordCalls,
        ),
      )
      .toEqual([
        {
          email: "person.name@example.com",
          options: { redirectTo: expectedRedirectTo },
        },
      ]);
  });

  test("forgot-password maps a returned Supabase error to the existing rendered error", async ({
    page,
  }) => {
    await openPublicShell(page);
    await page.evaluate(async () => {
      const { supabase } = await import("/src/services/supabaseClient.ts");
      Object.defineProperty(supabase.auth, "resetPasswordForEmail", {
        configurable: true,
        value: async () => ({
          data: {},
          error: {
            name: "AuthApiError",
            message: "rate limit exceeded",
            status: 429,
            code: "over_request_rate_limit",
          },
        }),
      });
    });

    await navigateApp(page, "/forgot-password");
    await page.getByLabel("Account Email").fill("person@example.com");
    await page.getByRole("button", { name: "Send reset link" }).click();

    await expect(page.getByText("Unable to send reset link. Please try again.")).toBeVisible();
    await expect(page.getByText("Password reset link sent.")).toHaveCount(0);
  });

  test("reset-password updates the recovery user and signs out only the local Supabase session", async ({
    page,
  }) => {
    await openPublicShell(page);
    await page.evaluate(async () => {
      const { supabase } = await import("/src/services/supabaseClient.ts");
      const events: Array<{ method: string; payload?: unknown }> = [];
      (window as unknown as { __resetPasswordEvents: typeof events }).__resetPasswordEvents = events;
      Object.defineProperty(supabase.auth, "getSession", {
        configurable: true,
        value: async () => {
          events.push({ method: "getSession" });
          return {
            data: {
              session: {
                access_token: "recovery-access-token",
                refresh_token: "recovery-refresh-token",
                expires_in: 3600,
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                token_type: "bearer",
                user: {
                  id: "recovery-user",
                  aud: "authenticated",
                  role: "authenticated",
                  email: "person@example.com",
                  app_metadata: {},
                  user_metadata: {},
                  identities: [],
                  created_at: new Date().toISOString(),
                },
              },
            },
            error: null,
          };
        },
      });
      Object.defineProperty(supabase.auth, "updateUser", {
        configurable: true,
        value: async (payload: unknown) => {
          events.push({ method: "updateUser", payload });
          return {
            data: {
              user: {
                id: "recovery-user",
                aud: "authenticated",
                role: "authenticated",
                email: "person@example.com",
                app_metadata: {},
                user_metadata: {},
                identities: [],
                created_at: new Date().toISOString(),
              },
            },
            error: null,
          };
        },
      });
      Object.defineProperty(supabase.auth, "signOut", {
        configurable: true,
        value: async (payload: unknown) => {
          events.push({ method: "signOut", payload });
          return { error: null };
        },
      });
    });

    await navigateApp(page, "/reset-password?type=recovery");
    await expect(page.getByRole("button", { name: "Update Password" })).toBeEnabled();
    await page.getByLabel("New Password", { exact: true }).fill("new-password-123");
    await page.getByLabel("Confirm Password").fill("new-password-123");
    await page.getByRole("button", { name: "Update Password" }).click();

    await expect(page.getByText("Password successfully updated.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to Login" })).toHaveAttribute("href", "/login");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __resetPasswordEvents: unknown[] }).__resetPasswordEvents,
        ),
      )
      .toEqual([
        { method: "getSession" },
        { method: "updateUser", payload: { password: "new-password-123" } },
        { method: "signOut", payload: { scope: "local" } },
      ]);
  });
});
