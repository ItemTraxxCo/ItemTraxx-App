import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  mockSystemStatus,
  mockUnauthenticatedSession,
  navigateApp,
  setTenantAdminSession,
  waitForPublicAuthBootstrap,
} from "./helpers/testHarness";

const authenticatedSessionSummary = () => ({
  authenticated: true,
  user: {
    id: "user-tenant-refresh",
    email: "tenant.user@example.com",
    last_sign_in_at: new Date().toISOString(),
  },
  profile: {
    role: "tenant_user",
    tenant_id: "tenant-e2e",
    district_id: null,
    auth_email: "tenant.user@example.com",
    is_active: true,
  },
});

const clearedAuthContext = {
  isInitialized: true,
  isAuthenticated: false,
  userId: null,
  email: null,
  signedInAt: null,
  role: null,
  sessionTenantId: null,
  tenantContextId: null,
  districtContextId: null,
  isAdmin: false,
  isDistrictAdmin: false,
  isSuperAdmin: false,
  hasSecondaryAuth: false,
  superVerifiedAt: null,
  adminVerifiedAt: null,
  pendingToken: null,
  pendingEmail: null,
  persistedAdminVerification: null,
};

const mockRoleMismatchBoundaries = async (page: Page, mode: "otp" | "passkey") => {
  const trace: {
    verificationPayloads: unknown[];
    exchangePayload: unknown;
    logoutRequests: number;
  } = {
    verificationPayloads: [],
    exchangePayload: null,
    logoutRequests: 0,
  };
  const suffix = mode === "otp" ? "otp" : "passkey";
  await page.route(/\/functions(?:\/v1)?\/super-auth-verify(?:\?.*)?$/, async (route) => {
    const body = route.request().postDataJSON() as { action?: string };
    trace.verificationPayloads.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        body.action === "start_password_login"
          ? {
              challenge_started: true,
              email: `mismatch.${suffix}@example.com`,
              challenge_token: `mismatch-${suffix}-challenge`,
            }
          : mode === "otp"
            ? {
                verified: true,
                access_token: "mismatch-otp-access",
                refresh_token: "mismatch-otp-refresh",
              }
            : { verified: true }
      ),
    });
  });
  await page.route("**/auth/session/exchange", async (route) => {
    trace.exchangePayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/auth/session/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(authenticatedSessionSummary()),
    });
  });
  await page.route("**/rest/v1/tenants?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: "tenant-e2e", status: "active", district_id: "district-e2e" }]),
    });
  });
  await page.route("**/rest/v1/rpc/resolve_public_district_by_id", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route("**/auth/session/logout", async (route) => {
    trace.logoutRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  return trace;
};

const exerciseSuperRoleMismatch = async (page: Page, mode: "otp" | "passkey") =>
  page.evaluate(async (flow) => {
    const [
      auth,
      { getAuthState, markAdminVerified, setAuthStateFromBackend },
      { supabase },
    ] = await Promise.all([
      import("/src/services/authService.ts"),
      import("/src/store/authState.ts"),
      import("/src/services/supabaseClient.ts"),
    ]);
    let passkeyCalls = 0;
    if (flow === "passkey") {
      Object.defineProperty(supabase.auth, "signInWithPasskey", {
        configurable: true,
        value: async () => {
          passkeyCalls += 1;
          return {
            data: {
              session: {
                access_token: "mismatch-passkey-access",
                refresh_token: "mismatch-passkey-refresh",
              },
            },
            error: null,
          };
        },
      });
    }
    Object.defineProperty(supabase.auth, "signOut", {
      configurable: true,
      value: async () => ({ error: null }),
    });
    await auth.superAdminLogin(
      `mismatch.${flow}@example.com`,
      "correct horse battery staple",
      `turnstile-${flow}-mismatch`,
    );
    setAuthStateFromBackend({
      isInitialized: true,
      isAuthenticated: true,
      userId: `stale-super-${flow}`,
      email: "stale.super@example.com",
      signedInAt: new Date().toISOString(),
      role: "super_admin",
      sessionTenantId: "stale-tenant",
      tenantContextId: "stale-tenant",
      districtContextId: "stale-district",
      hasSecondaryAuth: true,
      superVerifiedAt: new Date().toISOString(),
    });
    markAdminVerified();
    const pendingBefore = {
      token: auth.getPendingSuperAdminChallengeToken(),
      email: auth.getPendingSuperAdminVerificationEmail(),
    };
    let errorMessage: string | null = null;
    try {
      if (flow === "otp") {
        await auth.verifySuperAdminEmailChallenge("654321");
      } else {
        await auth.superAdminPasskeyLogin({
          sendLoginNotification: false,
          loginLocation: "super_settings",
        });
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    const state = getAuthState();
    return {
      passkeyCalls,
      pendingBefore,
      errorMessage,
      after: {
        isInitialized: state.isInitialized,
        isAuthenticated: state.isAuthenticated,
        userId: state.userId,
        email: state.email,
        signedInAt: state.signedInAt,
        role: state.role,
        sessionTenantId: state.sessionTenantId,
        tenantContextId: state.tenantContextId,
        districtContextId: state.districtContextId,
        isAdmin: state.isAdmin,
        isDistrictAdmin: state.isDistrictAdmin,
        isSuperAdmin: state.isSuperAdmin,
        hasSecondaryAuth: state.hasSecondaryAuth,
        superVerifiedAt: state.superVerifiedAt,
        adminVerifiedAt: state.adminVerifiedAt,
        pendingToken: auth.getPendingSuperAdminChallengeToken(),
        pendingEmail: auth.getPendingSuperAdminVerificationEmail(),
        persistedAdminVerification: sessionStorage.getItem("itemtraxx:admin-verification"),
      },
    };
  }, mode);

test.describe("Auth edge cases", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
  });

  test("unauthenticated tenant admin route redirects to public home", async ({ page }) => {
    await page.goto("/");
    await navigateApp(page, "/tenant/admin");
    await expect(page).toHaveURL(/\/$/);
  });

  test("unauthenticated super admin route redirects to public home", async ({ page }) => {
    await page.goto("/");
    await navigateApp(page, "/super-admin");
    await expect(page).toHaveURL(/\/$/);
  });

  test("public session bootstrap renders for an unauthenticated session without contacting Supabase", async ({ page }) => {
    const requestedUrls: string[] = [];
    let sessionSummaryRequests = 0;
    page.on("request", (request) => requestedUrls.push(request.url()));
    await page.route("**/auth/session/me", async (route) => {
      sessionSummaryRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: false, user: null, profile: null }),
      });
    });

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "ItemTraxx", exact: true })).toBeVisible();
    await waitForPublicAuthBootstrap(page);
    await expect.poll(() => sessionSummaryRequests).toBe(1);
    expect(requestedUrls.some((url) => /\.supabase\.(?:co|in)\//.test(url))).toBe(false);
  });

  for (const path of [
    "/forgot-password",
    "/legal/student-privacy",
    "/landing-old",
    "/landing-new2",
  ]) {
    test(`${path} uses public auth bootstrap on first mount`, async ({ page }) => {
      await page.goto(path);

      await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
      await waitForPublicAuthBootstrap(page);
    });
  }

  test("normal production entry graph does not statically own E2E controls", async () => {
    const mainSource = await readFile(new URL("../../src/main.ts", import.meta.url), "utf8");

    expect(mainSource).toContain('await import("./e2e/testControls")');
    expect(mainSource).not.toMatch(/from ["']\.\/e2e\/testControls["']/);
  });

  test("public session bootstrap preserves the authenticated role redirect", async ({ page }) => {
    let sessionSummaryRequests = 0;
    await page.route("**/auth/session/me", async (route) => {
      sessionSummaryRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(authenticatedSessionSummary()),
      });
    });
    await page.route("**/rest/v1/tenants?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "tenant-e2e", status: "active", district_id: "district-e2e" },
        ]),
      });
    });
    await page.route("**/rest/v1/rpc/resolve_public_district_by_id", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "district-e2e",
            name: "E2E District",
            slug: "e2e-district",
            is_active: true,
          },
        ]),
      });
    });
    await page.route("https://e2e-district.app.itemtraxx.com/tenant/checkout", async (route) => {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html>" });
    });

    await page.goto("/");

    await expect.poll(() => sessionSummaryRequests).toBe(1);
    await expect(page).toHaveURL("https://e2e-district.app.itemtraxx.com/tenant/checkout");
  });

  test("suspended tenant bootstrap fails closed and clears the authenticated state", async ({ page }) => {
    await page.route("**/auth/session/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(authenticatedSessionSummary()),
      });
    });
    await page.route("**/rest/v1/tenants?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "tenant-e2e", status: "suspended", district_id: "district-e2e" },
        ]),
      });
    });

    await page.goto("/");
    await waitForPublicAuthBootstrap(page);

    await expect(page).toHaveURL(/\/$/);
    expect(
      await page.evaluate(() => window.__itemtraxxTest !== undefined)
    ).toBe(true);
    await navigateApp(page, "/tenant/checkout");
    await expect(page).toHaveURL(/\/$/);
  });

  test("district handoff consumes only the one-time code and removes auth material from the URL", async ({ page }) => {
    let consumePayload: unknown = null;
    let exchangePayload: unknown = null;
    await page.addInitScript(() => {
      const originalReplaceState = window.history.replaceState.bind(window.history);
      const originalFetch = window.fetch.bind(window);
      const authEvents: string[] = [];
      const recordedUrls: string[] = [];
      (window as unknown as { __districtHandoffEvents: string[] }).__districtHandoffEvents = authEvents;
      (window as unknown as { __authReplaceStateUrls: string[] }).__authReplaceStateUrls = recordedUrls;
      window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
        const nextUrl = String(url ?? "");
        recordedUrls.push(nextUrl);
        if (nextUrl === "/#keep=1") {
          authEvents.push("url-scrub");
        }
        originalReplaceState(data, unused, url);
      };
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (/\/functions(?:\/v1)?\/district-handoff(?:\?.*)?$/.test(url)) {
          authEvents.push("consume-request");
        } else if (/\/auth\/session\/exchange(?:\?.*)?$/.test(url)) {
          authEvents.push("session-exchange");
        }
        return originalFetch(input, init);
      };
    });
    await page.route(/\/functions(?:\/v1)?\/district-handoff(?:\?.*)?$/, async (route) => {
      consumePayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ access_token: "access-e2e", refresh_token: "refresh-e2e" }),
      });
    });
    await page.route("**/auth/session/exchange", async (route) => {
      exchangePayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(authenticatedSessionSummary()),
      });
    });
    await page.route(/\/functions(?:\/v1)?\/login-notify(?:\?.*)?$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
    });
    await page.route("**/rest/v1/tenants?**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "tenant-e2e", status: "active", district_id: null }]) });
    });

    await page.goto("/#itx_hc=one-time-code&itx_lm=password&itx_ll=tenant_login&keep=1");

    await expect.poll(() => consumePayload).not.toBeNull();
    expect(consumePayload).toEqual({ action: "consume", code: "one-time-code" });
    await expect.poll(() => exchangePayload).toEqual({
      access_token: "access-e2e",
      refresh_token: "refresh-e2e",
    });
    expect(
      await page.evaluate(
        () => (window as unknown as { __authReplaceStateUrls: string[] }).__authReplaceStateUrls
      )
    ).toContain("/#keep=1");
    expect(
      await page.evaluate(
        () => (window as unknown as { __districtHandoffEvents: string[] }).__districtHandoffEvents
      )
    ).toEqual([
      "url-scrub",
      "consume-request",
      "session-exchange",
    ]);
    expect(await page.evaluate(() => sessionStorage.getItem("itemtraxx:district-handoff-at"))).toMatch(/^\d+$/);
  });

  test("deprecated raw district tokens are rejected and scrubbed without exchange", async ({ page }) => {
    const tokenConsumptionRequests: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (/\/functions(?:\/v1)?\/district-handoff(?:\?.*)?$/.test(url)) {
        tokenConsumptionRequests.push("district-handoff");
      } else if (/\/auth\/v1\/verify(?:\?.*)?$/.test(url)) {
        tokenConsumptionRequests.push("otp-verify");
      } else if (/\/auth\/v1\/token(?:\?.*)?$/.test(url)) {
        tokenConsumptionRequests.push("supabase-token");
      } else if (/\/auth\/session\/exchange(?:\?.*)?$/.test(url)) {
        tokenConsumptionRequests.push("session-exchange");
      }
    });
    await page.addInitScript(() => {
      const originalReplaceState = window.history.replaceState.bind(window.history);
      const recordedUrls: string[] = [];
      (window as unknown as { __authReplaceStateUrls: string[] }).__authReplaceStateUrls = recordedUrls;
      window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
        recordedUrls.push(String(url ?? ""));
        originalReplaceState(data, unused, url);
      };
    });
    await page.route(/\/functions(?:\/v1)?\/district-handoff(?:\?.*)?$/, async (route) => {
      await route.fulfill({ status: 500, body: "unexpected district handoff" });
    });
    await page.route(/\/auth\/v1\/(?:verify|token)(?:\?.*)?$/, async (route) => {
      await route.fulfill({ status: 500, body: "unexpected Supabase token consumption" });
    });
    await page.route("**/auth/session/exchange", async (route) => {
      await route.fulfill({ status: 500, body: "unexpected" });
    });

    await page.goto("/#itx_at=raw-access&itx_rt=raw-refresh&keep=1");

    await expect.poll(async () =>
      page.evaluate(
        () => (window as unknown as { __authReplaceStateUrls: string[] }).__authReplaceStateUrls
      )
    ).toContain("/#keep=1");
    await waitForPublicAuthBootstrap(page);
    expect(tokenConsumptionRequests).toEqual([]);
  });

  test("super-admin password challenge preserves action and payload contract", async ({ page }) => {
    let challengePayload: unknown = null;
    await page.route(/\/functions(?:\/v1)?\/super-auth-verify(?:\?.*)?$/, async (route) => {
      challengePayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ challenge_started: true, email: "super@example.com", challenge_token: "challenge-e2e" }),
      });
    });

    await page.goto("/super-auth");
    await page.evaluate(async () => {
      const auth = await import("/src/services/authService.ts");
      await auth.superAdminLogin("super@example.com", "correct horse battery staple", "turnstile-e2e");
    });

    await expect.poll(() => challengePayload).not.toBeNull();
    expect(challengePayload).toEqual({
      action: "start_password_login",
      payload: {
        email: "super@example.com",
        password: "correct horse battery staple",
        turnstile_token: "turnstile-e2e",
      },
    });
    expect(
      await page.evaluate(async () => {
        const auth = await import("/src/services/authService.ts");
        return {
          token: auth.getPendingSuperAdminChallengeToken(),
          email: auth.getPendingSuperAdminVerificationEmail(),
        };
      })
    ).toEqual({ token: "challenge-e2e", email: "super@example.com" });
  });

  test("tenant-admin session login marks a fresh 15-minute verification", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/privileged-step-up(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { registered: true, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() } }),
      });
    });
    await page.route(/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { ok: true } }) });
    });
    await page.route(/\/functions(?:\/v1)?\/login-notify(?:\?.*)?$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    });
    await page.route("**/rest/v1/tenants?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "tenant-admin-e2e", status: "active", district_id: null }]),
      });
    });

    await page.goto("/");
    const result = await page.evaluate(async () => {
      const auth = await import("/src/services/authService.ts");
      const { getAuthState } = await import("/src/store/authState.ts");
      const login = await auth.adminLoginWithSession("admin-access", "admin-refresh", {
        skipExchange: true,
        preExchangedSessionSummary: {
          authenticated: true,
          user: {
            id: "tenant-admin-user-e2e",
            email: "tenant.admin@example.com",
            last_sign_in_at: new Date().toISOString(),
          },
          profile: {
            role: "tenant_admin",
            tenant_id: "tenant-admin-e2e",
            district_id: null,
            auth_email: "tenant.admin@example.com",
            is_active: true,
          },
        },
      });
      const state = getAuthState();
      return {
        role: login.role,
        tenantId: login.tenantId,
        verifiedAt: state.adminVerifiedAt,
        persisted: sessionStorage.getItem("itemtraxx:admin-verification"),
      };
    });

    expect(result.role).toBe("tenant_admin");
    expect(result.tenantId).toBe("tenant-admin-e2e");
    expect(Date.now() - Date.parse(result.verifiedAt ?? "")).toBeLessThanOrEqual(15 * 60_000);
    expect(JSON.parse(result.persisted ?? "null")).toMatchObject({
      userId: "tenant-admin-user-e2e",
      verifiedAt: result.verifiedAt,
    });
  });

  test("super-admin passkey login preserves verification payload and fresh secondary auth", async ({ page }) => {
    let verifyPayload: unknown = null;
    await page.route(/\/functions(?:\/v1)?\/super-auth-verify(?:\?.*)?$/, async (route) => {
      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "start_password_login") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            challenge_started: true,
            email: "pending.passkey@example.com",
            challenge_token: "pending-passkey-challenge",
          }),
        });
        return;
      }
      verifyPayload = body;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ verified: true }),
      });
    });
    await page.route("**/auth/session/exchange", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.route("**/auth/session/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: {
            id: "super-passkey-e2e",
            email: "super@example.com",
            last_sign_in_at: new Date().toISOString(),
          },
          profile: {
            role: "super_admin",
            tenant_id: null,
            district_id: null,
            auth_email: "super@example.com",
            is_active: true,
          },
        }),
      });
    });
    await page.route(/\/functions(?:\/v1)?\/super-ops(?:\?.*)?$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { ok: true } }) });
    });

    await page.goto("/");
    const result = await page.evaluate(async () => {
      const [{ supabase }, auth, { getAuthState }] = await Promise.all([
        import("/src/services/supabaseClient.ts"),
        import("/src/services/authService.ts"),
        import("/src/store/authState.ts"),
      ]);
      const passkeySession = {
        access_token: "passkey-access",
        refresh_token: "passkey-refresh",
      };
      Object.defineProperty(supabase.auth, "signInWithPasskey", {
        configurable: true,
        value: async () => ({ data: { session: passkeySession }, error: null }),
      });
      await auth.superAdminLogin(
        "pending.passkey@example.com",
        "correct horse battery staple",
        "turnstile-e2e",
      );
      const pendingBefore = {
        token: auth.getPendingSuperAdminChallengeToken(),
        email: auth.getPendingSuperAdminVerificationEmail(),
      };
      await auth.superAdminPasskeyLogin({
        sendLoginNotification: false,
        loginLocation: "super_settings",
      });
      const state = getAuthState();
      return {
        pendingBefore,
        pendingAfter: {
          token: auth.getPendingSuperAdminChallengeToken(),
          email: auth.getPendingSuperAdminVerificationEmail(),
        },
        role: state.role,
        hasSecondaryAuth: state.hasSecondaryAuth,
        verifiedAt: state.superVerifiedAt,
      };
    });

    expect(verifyPayload).toEqual({ action: "complete_passkey_login", payload: {} });
    expect(result.pendingBefore).toEqual({
      token: "pending-passkey-challenge",
      email: "pending.passkey@example.com",
    });
    expect(result.pendingAfter).toEqual({ token: null, email: null });
    expect(result.role).toBe("super_admin");
    expect(result.hasSecondaryAuth).toBe(true);
    expect(Date.now() - Date.parse(result.verifiedAt ?? "")).toBeLessThanOrEqual(15 * 60_000);
  });

  test("successful super-admin OTP verification clears the shared pending challenge", async ({ page }) => {
    let verificationPayload: unknown = null;
    await page.route(/\/functions(?:\/v1)?\/super-auth-verify(?:\?.*)?$/, async (route) => {
      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "start_password_login") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            challenge_started: true,
            email: "pending.otp@example.com",
            challenge_token: "pending-otp-challenge",
          }),
        });
        return;
      }
      verificationPayload = body;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          verified: true,
          access_token: "otp-access",
          refresh_token: "otp-refresh",
        }),
      });
    });
    await page.route("**/auth/session/exchange", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.route("**/auth/session/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: {
            id: "super-otp-e2e",
            email: "pending.otp@example.com",
            last_sign_in_at: new Date().toISOString(),
          },
          profile: {
            role: "super_admin",
            tenant_id: null,
            district_id: null,
            auth_email: "pending.otp@example.com",
            is_active: true,
          },
        }),
      });
    });
    await page.route(/\/functions(?:\/v1)?\/(?:super-ops|login-notify)(?:\?.*)?$/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { ok: true } }) });
    });

    await page.goto("/");
    const result = await page.evaluate(async () => {
      const auth = await import("/src/services/authService.ts");
      await auth.superAdminLogin(
        "pending.otp@example.com",
        "correct horse battery staple",
        "turnstile-e2e",
      );
      const pendingBefore = {
        token: auth.getPendingSuperAdminChallengeToken(),
        email: auth.getPendingSuperAdminVerificationEmail(),
      };
      await auth.verifySuperAdminEmailChallenge("123456");
      return {
        pendingBefore,
        pendingAfter: {
          token: auth.getPendingSuperAdminChallengeToken(),
          email: auth.getPendingSuperAdminVerificationEmail(),
        },
      };
    });

    expect(verificationPayload).toEqual({
      action: "verify_email_challenge",
      payload: { code: "123456", challenge_token: "pending-otp-challenge" },
    });
    expect(result.pendingBefore).toEqual({
      token: "pending-otp-challenge",
      email: "pending.otp@example.com",
    });
    expect(result.pendingAfter).toEqual({ token: null, email: null });
  });

  test("super-admin OTP role mismatch fails closed and clears every auth context", async ({ page }) => {
    const trace = await mockRoleMismatchBoundaries(page, "otp");

    await page.goto("/");
    await waitForPublicAuthBootstrap(page);
    const result = await exerciseSuperRoleMismatch(page, "otp");

    expect(trace.verificationPayloads).toEqual([
      {
        action: "start_password_login",
        payload: {
          email: "mismatch.otp@example.com",
          password: "correct horse battery staple",
          turnstile_token: "turnstile-otp-mismatch",
        },
      },
      {
        action: "verify_email_challenge",
        payload: { code: "654321", challenge_token: "mismatch-otp-challenge" },
      },
    ]);
    expect(trace.exchangePayload).toEqual({
      access_token: "mismatch-otp-access",
      refresh_token: "mismatch-otp-refresh",
    });
    expect(result.pendingBefore).toEqual({
      token: "mismatch-otp-challenge",
      email: "mismatch.otp@example.com",
    });
    expect(result.errorMessage).toBe("Access denied.");
    expect(trace.logoutRequests).toBe(1);
    expect(result.after).toEqual(clearedAuthContext);
  });

  test("super-admin passkey role mismatch fails closed and clears every auth context", async ({ page }) => {
    const trace = await mockRoleMismatchBoundaries(page, "passkey");

    await page.goto("/");
    await waitForPublicAuthBootstrap(page);
    const result = await exerciseSuperRoleMismatch(page, "passkey");

    expect(trace.verificationPayloads).toEqual([
      {
        action: "start_password_login",
        payload: {
          email: "mismatch.passkey@example.com",
          password: "correct horse battery staple",
          turnstile_token: "turnstile-passkey-mismatch",
        },
      },
      { action: "complete_passkey_login", payload: {} },
    ]);
    expect(trace.exchangePayload).toEqual({
      access_token: "mismatch-passkey-access",
      refresh_token: "mismatch-passkey-refresh",
    });
    expect(result.passkeyCalls).toBe(1);
    expect(result.pendingBefore).toEqual({
      token: "mismatch-passkey-challenge",
      email: "mismatch.passkey@example.com",
    });
    expect(result.errorMessage).toBe("Access denied.");
    expect(trace.logoutRequests).toBe(1);
    expect(result.after).toEqual(clearedAuthContext);
  });

  for (const missingSessionMode of ["returned", "thrown"] as const) {
    test(`${missingSessionMode} missing-session logout preserves cleanup order and clears every auth context`, async ({ page }) => {
      await page.route(/\/functions(?:\/v1)?\/super-auth-verify(?:\?.*)?$/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            challenge_started: true,
            email: "pending.super@example.com",
            challenge_token: "pending-challenge-e2e",
          }),
        });
      });
      await page.goto("/");
      await waitForPublicAuthBootstrap(page);
      const result = await page.evaluate(async (mode) => {
        const [
          auth,
          {
            getAuthState,
            markAdminVerified,
            setAuthStateFromBackend,
            setDistrictContext,
            setTenantContext,
          },
          { supabase },
        ] = await Promise.all([
          import("/src/services/authService.ts"),
          import("/src/store/authState.ts"),
          import("/src/services/supabaseClient.ts"),
        ]);
        const cleanupEvents: string[] = [];
        const pendingSnapshots: Array<{ event: string; state: unknown }> = [];
        const resolutionSnapshots: Array<{ event: string; state: unknown }> = [];
        const snapshot = () => {
          const state = getAuthState();
          return {
            isInitialized: state.isInitialized,
            isAuthenticated: state.isAuthenticated,
            userId: state.userId,
            email: state.email,
            signedInAt: state.signedInAt,
            role: state.role,
            sessionTenantId: state.sessionTenantId,
            tenantContextId: state.tenantContextId,
            districtContextId: state.districtContextId,
            isAdmin: state.isAdmin,
            isDistrictAdmin: state.isDistrictAdmin,
            isSuperAdmin: state.isSuperAdmin,
            hasSecondaryAuth: state.hasSecondaryAuth,
            superVerifiedAt: state.superVerifiedAt,
            adminVerifiedAt: state.adminVerifiedAt,
            pendingToken: auth.getPendingSuperAdminChallengeToken(),
            pendingEmail: auth.getPendingSuperAdminVerificationEmail(),
            persistedAdminVerification: sessionStorage.getItem("itemtraxx:admin-verification"),
          };
        };
        const createBoundary = () => {
          let markReached!: () => void;
          let release!: () => void;
          let markResolved!: () => void;
          return {
            reached: new Promise<void>((resolve) => {
              markReached = resolve;
            }),
            released: new Promise<void>((resolve) => {
              release = resolve;
            }),
            resolved: new Promise<void>((resolve) => {
              markResolved = resolve;
            }),
            markReached: () => markReached(),
            release: () => release(),
            markResolved: () => markResolved(),
          };
        };
        const boundaries = {
          adminRevoke: createBoundary(),
          localSupabase: createBoundary(),
          httpSession: createBoundary(),
        };
        const recordPending = (event: string) => {
          pendingSnapshots.push({ event, state: snapshot() });
        };
        const recordResolution = (event: string) => {
          resolutionSnapshots.push({ event, state: snapshot() });
        };
        const markBoundaryReached = (event: string) => {
          cleanupEvents.push(event);
        };
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/.test(url)) {
            const body = typeof init?.body === "string" ? JSON.parse(init.body) as { action?: string } : {};
            if (body.action === "revoke_current_session") {
              markBoundaryReached("admin-revoke");
              boundaries.adminRevoke.markReached();
              await boundaries.adminRevoke.released;
              recordResolution("admin-revoke");
              boundaries.adminRevoke.markResolved();
              return new Response(JSON.stringify({ data: { revoked: true } }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }
          } else if (/\/auth\/session\/logout(?:\?.*)?$/.test(url)) {
            markBoundaryReached("http-session");
            boundaries.httpSession.markReached();
            await boundaries.httpSession.released;
            recordResolution("http-session");
            boundaries.httpSession.markResolved();
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return originalFetch(input, init);
        };
        const missingSessionError = {
          name: "AuthSessionMissingError",
          message: "Auth session missing!",
          status: 403,
          code: "session_not_found",
          __isAuthError: true,
        };
        Object.defineProperty(supabase.auth, "signOut", {
          configurable: true,
          value: async () => {
            markBoundaryReached("local-supabase");
            boundaries.localSupabase.markReached();
            await boundaries.localSupabase.released;
            recordResolution("local-supabase");
            boundaries.localSupabase.markResolved();
            if (mode === "thrown") {
              throw missingSessionError;
            }
            return { error: missingSessionError };
          },
        });
        await auth.superAdminLogin(
          "pending.super@example.com",
          "correct horse battery staple",
          "turnstile-e2e",
        );
        const signedInAt = new Date(Date.now() - 60_000).toISOString();
        const superVerifiedAt = new Date(Date.now() - 30_000).toISOString();
        setAuthStateFromBackend({
          isInitialized: true,
          isAuthenticated: true,
          userId: "tenant-admin-e2e",
          email: "tenant.admin@example.com",
          signedInAt,
          role: "tenant_admin",
          sessionTenantId: "tenant-e2e",
          tenantContextId: "tenant-e2e",
          districtContextId: "district-e2e",
          hasSecondaryAuth: true,
          superVerifiedAt,
        });
        setTenantContext("tenant-e2e");
        setDistrictContext("district-e2e");
        markAdminVerified();
        const before = snapshot();
        const signOutPromise = auth.signOut();

        await boundaries.adminRevoke.reached;
        recordPending("admin-revoke");
        boundaries.adminRevoke.release();
        await boundaries.adminRevoke.resolved;

        await boundaries.localSupabase.reached;
        recordPending("local-supabase");
        boundaries.localSupabase.release();
        await boundaries.localSupabase.resolved;

        await boundaries.httpSession.reached;
        recordPending("http-session");
        boundaries.httpSession.release();
        await boundaries.httpSession.resolved;

        await signOutPromise;
        return {
          before,
          cleanupEvents,
          pendingSnapshots,
          resolutionSnapshots,
          after: snapshot(),
        };
      }, missingSessionMode);

      expect(result.before).toMatchObject({
        isInitialized: true,
        isAuthenticated: true,
        userId: "tenant-admin-e2e",
        email: "tenant.admin@example.com",
        role: "tenant_admin",
        sessionTenantId: "tenant-e2e",
        tenantContextId: "tenant-e2e",
        districtContextId: "district-e2e",
        isAdmin: true,
        isDistrictAdmin: false,
        isSuperAdmin: false,
        hasSecondaryAuth: true,
        pendingToken: "pending-challenge-e2e",
        pendingEmail: "pending.super@example.com",
      });
      expect(result.before.signedInAt).toBeTruthy();
      expect(result.before.superVerifiedAt).toBeTruthy();
      expect(result.before.adminVerifiedAt).toBeTruthy();
      expect(result.before.persistedAdminVerification).toBeTruthy();
      expect(result.cleanupEvents).toEqual(["admin-revoke", "local-supabase", "http-session"]);
      expect(result.pendingSnapshots).toEqual([
        { event: "admin-revoke", state: result.before },
        { event: "local-supabase", state: result.before },
        { event: "http-session", state: result.before },
      ]);
      expect(result.resolutionSnapshots).toEqual([
        { event: "admin-revoke", state: result.before },
        { event: "local-supabase", state: result.before },
        { event: "http-session", state: result.before },
      ]);
      expect(result.after).toEqual(clearedAuthContext);
    });
  }

  test("forced tenant-admin termination shows the blocking session message", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/, async (route) => {
      const body = (route.request().postDataJSON() as { action?: string }) ?? {};
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: body.action === "validate_session" ? { valid: false } : { ok: true } }),
      });
    });

    await page.goto("/");
    await setTenantAdminSession(page, "tenant-e2e");
    await navigateApp(page, "/tenant/admin");

    await expect(page.getByRole("heading", { name: "This session has been terminated or expired." })).toBeVisible();
  });

  test("role normalization accepts only the four authenticated roles", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const { toKnownRole } = await import("/src/services/auth/types.ts");
      const allowed = [
        "tenant_user",
        "tenant_admin",
        "district_admin",
        "super_admin",
      ];
      const rejected: unknown[] = [
        "owner",
        "Tenant_Admin",
        "",
        null,
        undefined,
        42,
        {},
      ];
      return {
        allowed: allowed.map((value) => [value, toKnownRole(value)]),
        rejected: rejected.map((value) => toKnownRole(value)),
      };
    });

    expect(result.allowed).toEqual([
      ["tenant_user", "tenant_user"],
      ["tenant_admin", "tenant_admin"],
      ["district_admin", "district_admin"],
      ["super_admin", "super_admin"],
    ]);
    expect(result.rejected).toEqual([null, null, null, null, null, null, null]);
  });

  test("authenticated tenant checkout survives refresh when tenant bootstrap lookup returns 401", async ({ page }) => {
    await page.route("**/auth/session/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(authenticatedSessionSummary()),
      });
    });

    await page.route("**/rest/v1/tenants?**", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unauthorized" }),
      });
    });

    await page.goto("/tenant/checkout");
    await expect(page).toHaveURL(/\/tenant\/checkout$/);

    await page.reload();
    await expect(page).toHaveURL(/\/tenant\/checkout$/);
    await expect(page).not.toHaveURL(/\/login$/);
  });

  test("tenant admin on checkout is not logged out by admin-session validation", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/, async (route) => {
      const body = (route.request().postDataJSON() as { action?: string }) ?? {};
      if (body.action === "validate_session") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { valid: false } }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { ok: true } }),
      });
    });

    await page.goto("/");
    await setTenantAdminSession(page, "tenant-e2e");
    await navigateApp(page, "/tenant/checkout");
    await expect(page).toHaveURL(/\/tenant\/checkout$/);
    await page.reload();
    await expect(page).toHaveURL(/\/tenant\/checkout$/);
    await expect(page).not.toHaveURL(/\/login$/);
  });

  test("authenticated tenant admin on public marketing routes is not forced to checkout or login", async ({ page }) => {
    await page.goto("/");
    await setTenantAdminSession(page, "tenant-e2e");
    await navigateApp(page, "/about");
    await expect(page).toHaveURL(/\/about$/);
    await expect(page).not.toHaveURL(/\/login$/);
  });

  test("tenant admin does not bounce from admin home to checkout immediately", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/, async (route) => {
      const body = (route.request().postDataJSON() as { action?: string }) ?? {};
      if (body.action === "validate_session") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { valid: true } }),
        });
        return;
      }
      if (body.action === "get_tenant_settings") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              checkout_due_hours: 48,
              account_category: "organization",
              plan_code: "core",
              feature_flags: {
                enable_notifications: true,
                enable_bulk_item_import: true,
                enable_bulk_student_tools: true,
                enable_status_tracking: true,
                enable_barcode_generator: true,
              },
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { ok: true } }),
      });
    });

    await page.goto("/");
    await setTenantAdminSession(page, "tenant-e2e");
    await navigateApp(page, "/tenant/admin");
    await expect(page).toHaveURL(/\/tenant\/admin$/);
    await page.waitForTimeout(6000);
    await expect(page).toHaveURL(/\/tenant\/admin$/);
    await expect(page).not.toHaveURL(/\/tenant\/checkout$/);
  });

  test("hidden tenant admin navigation defers session polling until visibility returns", async ({ page }) => {
    let touchRequests = 0;
    let validationRequests = 0;
    await page.route(/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/, async (route) => {
      const body = (route.request().postDataJSON() as { action?: string }) ?? {};
      if (body.action === "touch_session") touchRequests += 1;
      if (body.action === "validate_session") validationRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { ok: true, valid: true } }),
      });
    });

    await page.goto("/");
    await setTenantAdminSession(page, "tenant-e2e");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await navigateApp(page, "/tenant/admin");
    await page.waitForTimeout(250);

    expect(touchRequests).toBe(0);
    expect(validationRequests).toBe(0);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await expect.poll(() => touchRequests).toBe(1);
    await expect.poll(() => validationRequests).toBe(1);
  });

  test("tenant admin dev hosts disable idle logout behavior", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/admin-ops(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { valid: true, ok: true } }),
      });
    });

    await page.goto("/");
    await setTenantAdminSession(page, "tenant-e2e");
    await page.evaluate(() => {
      window.history.replaceState({}, "", "/tenant/admin");
    });
    await page.reload();
    await expect(page).toHaveURL(/\/tenant\/admin$/);
    await page.waitForTimeout(3500);
    await expect(page).toHaveURL(/\/tenant\/admin$/);
  });
});
