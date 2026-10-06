import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  clearCookieConsentCookie,
  mockSystemStatus,
  mockUnauthenticatedSession,
  navigateApp,
  readCookieConsentPreferences,
} from "./helpers/testHarness";

const forbiddenSdkResponse = (url: string) => {
  const filename = new URL(url).pathname.split("/").pop()?.toLowerCase() ?? "";
  return (
    filename.endsWith(".js") &&
    ["jspdf", "html2canvas", "jsbarcode", "posthog", "sentry", "supabase"].some((name) =>
      filename.includes(name),
    )
  );
};

const authenticatedRouteResponse = (url: string) => {
  const pathname = new URL(url).pathname.toLowerCase();
  return pathname.includes("/checkout.vue") || pathname.includes("/admin/adminhome.vue");
};

const nonDevE2eOrigin = "http://127.0.0.1.nip.io:4173";

test.describe("Public surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
  });

  for (const viewport of [
    { label: "desktop", width: 1280, height: 900 },
    { label: "mobile", width: 390, height: 844 },
  ] as const) {
    test("canonical landing preserves the active design and responsive contracts on " + viewport.label, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");

      const hero = page.locator("section#comparison");
      await expect(hero.getByRole("heading", { level: 1, name: "Inventory Tracking Made Simple" })).toBeVisible();
      await expect(hero.getByRole("heading", { level: 2, name: "Just the way it should be." })).toBeVisible();
      await expect(page.locator("#workflow .what-row")).toHaveCount(3);
      await expect(page.locator("#before-after")).toBeVisible();
      await expect(page.locator("#platform")).toBeVisible();

      const primaryNav = page.locator(".main-nav");
      await expect(primaryNav.locator('a[href="/pricing"]')).toHaveAttribute("href", "/pricing");
      await expect(primaryNav.locator('a[href="/contact-support"]')).toHaveAttribute("href", "/contact-support");
      const statusLink = primaryNav.locator(".status-link");
      await expect(statusLink).toHaveAttribute("href", "https://status.itemtraxx.com/");
      await expect(statusLink).toHaveAttribute("target", "_blank");
      await expect(statusLink).toHaveAttribute("rel", "noreferrer");
      await expect(page.locator("header").getByRole("link", { name: "Login", exact: true })).toHaveAttribute("href", "/login");
      await expect(hero.getByRole("link", { name: "Get a demo", exact: true })).toHaveAttribute("href", "/request-demo");
      await expect(hero.getByRole("link", { name: "Pricing", exact: true })).toHaveAttribute("href", "/pricing");

      const image = page.locator(".comparison .checkout-image img");
      await expect(image).toHaveAttribute("alt", "ItemTraxx checkout and return screen showing borrower details, checked-out items and checkout controls");
      await expect(image).toHaveAttribute("width", "2780");
      await expect(image).toHaveAttribute("height", "1798");

      const finalCta = page.locator("section.final-cta");
      await expect(finalCta.getByRole("link", { name: "Get a demo", exact: true })).toHaveAttribute("href", "/request-demo");
      await expect(finalCta.getByRole("link", { name: "Explore pricing", exact: true })).toHaveAttribute("href", "/pricing");
      const footer = page.locator("footer.public-footer");
      await expect(footer.getByRole("link", { name: "Contact Support" })).toHaveAttribute("href", "/contact-support");
      await expect(footer.getByRole("link", { name: "Status", exact: true })).toHaveAttribute("href", "https://status.itemtraxx.com/");

      const responsiveContract = await page.evaluate(() => ({
        comparisonColumns: getComputedStyle(document.querySelector(".comparison") as HTMLElement).gridTemplateColumns.split(" ").length,
        workflowColumns: getComputedStyle(document.querySelector(".what-row") as HTMLElement).gridTemplateColumns.split(" ").length,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }));
      expect(responsiveContract.comparisonColumns).toBe(viewport.label === "desktop" ? 3 : 1);
      expect(responsiveContract.workflowColumns).toBe(viewport.label === "desktop" ? 3 : 2);
      expect(responsiveContract.documentWidth).toBeLessThanOrEqual(responsiveContract.viewportWidth);
    });
  }

  test("canonical page keeps status and product analytics behind shared facades", async () => {
    const pageSource = await readFile(
      new URL("../../src/pages/LandingPageNew.vue", import.meta.url),
      "utf8",
    );
    expect(pageSource).toContain('import { useSystemStatus } from "../composables/useSystemStatus"');
    expect(pageSource).toContain('import { trackProductEvent } from "../services/productEvents"');
    expect(pageSource).toContain('name: "landing_new_cta_click"');
    expect(pageSource).toContain('name: "landing_cta_clicked"');
    expect(pageSource).not.toMatch(/from ["'][^"']*(?:analyticsService|posthogService|systemStatusService)[^"']*["']/);
    expect(pageSource).toContain('id="comparison"');
    expect(pageSource).toContain('id="workflow"');
    expect(pageSource).toContain('id="before-after"');
    expect(pageSource).toContain('id="platform"');
  });

  test("shared public footers render the current year with identical link contracts", async ({ page }) => {
    await page.clock.install();
    await page.clock.setFixedTime(new Date("2027-02-03T12:00:00Z"));

    const footerContract = async () => {
      const footer = page.locator("footer.public-footer");
      await expect(footer.locator(".footer-brand")).toHaveText("©2027 ItemTraxx Co");
      return footer.locator("a").evaluateAll((links) =>
        links.map((link) => ({
          text: link.textContent?.trim() ?? "",
          href: link.getAttribute("href"),
          target: link.getAttribute("target"),
          rel: link.getAttribute("rel"),
        })),
      );
    };

    await page.goto("/");
    const canonicalFooter = await footerContract();

    await page.goto("/landing-new");
    expect(await footerContract()).toEqual(canonicalFooter);
  });

  test("the removed landing-new2 URL redirects to the active landing page", async ({ page }) => {
    await page.goto("/landing-new2");
    await expect(page).toHaveURL(/\/landing-new$/);
    await expect(page.getByRole("heading", { name: "Inventory Tracking Made Simple" })).toBeVisible();
  });

  test("the canonical landing demo CTA navigates to the demo request", async ({ page }) => {
    await page.goto("/");

    await page.locator("main").getByRole("link", { name: "Get a demo", exact: true }).first().click();

    await expect(page).toHaveURL(/\/request-demo$/);
    await expect(page.getByRole("heading", { name: "Request a Demo" })).toBeVisible();
  });

  test("canonical landing emits the exact event contract for every CTA location", async ({ page }) => {
    await page.route(/\/src\/services\/(analyticsService|posthogService)\.ts(?:\?.*)?$/, async (route) => {
      const service = route.request().url().includes("posthogService") ? "posthog" : "analytics";
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body:
          service === "analytics"
            ? `export const trackAnalyticsEvent = async (name, properties) => {
                window.__productEventDeliveries.analytics.push({ name, properties });
              };`
            : `export const capturePostHogEvent = (name, properties) => {
                window.__productEventDeliveries.posthog.push({ name, properties });
              };`,
      });
    });
    await page.addInitScript(() => {
      Object.defineProperty(window, "__productEventDeliveries", {
        configurable: true,
        value: { analytics: [], posthog: [] },
        writable: true,
      });
    });

    await page.goto("/");
    const ctas = [
      { locator: page.locator("header").getByRole("link", { name: "Login", exact: true }), destination: "/login" },
      { locator: page.locator(".hero-actions").getByRole("link", { name: "Pricing", exact: true }), destination: "/pricing" },
      { locator: page.locator(".hero-actions").getByRole("link", { name: "Get a demo", exact: true }), destination: "/request-demo" },
      { locator: page.locator(".final-cta-actions").getByRole("link", { name: "Get a demo", exact: true }), destination: "/request-demo" },
      { locator: page.locator(".final-cta-actions").getByRole("link", { name: "Explore pricing", exact: true }), destination: "/pricing" },
    ];
    for (const { locator, destination } of ctas) {
      await locator.click();
      await expect(page).toHaveURL(new RegExp(`${destination}$`));
      await page.goBack();
      await expect(page.getByRole("heading", { name: "Inventory Tracking Made Simple", exact: true })).toBeVisible();
    }

    await expect.poll(() => page.evaluate(() =>
      (window as Window & {
        __productEventDeliveries: {
          analytics: Array<{ name: string; properties: Record<string, unknown> }>;
          posthog: Array<{ name: string; properties: Record<string, unknown> }>;
        };
      }).__productEventDeliveries,
    )).toEqual({
      analytics: [
        { name: "landing_new_cta_click", properties: { cta: "login", location: "header" } },
        { name: "landing_new_cta_click", properties: { cta: "pricing", location: "hero" } },
        { name: "landing_new_cta_click", properties: { cta: "demo", location: "hero" } },
        { name: "landing_new_cta_click", properties: { cta: "demo", location: "final" } },
        { name: "landing_new_cta_click", properties: { cta: "pricing", location: "final" } },
      ],
      posthog: [
        { name: "landing_cta_clicked", properties: { cta: "login", location: "header" } },
        { name: "landing_cta_clicked", properties: { cta: "pricing", location: "hero" } },
        { name: "landing_cta_clicked", properties: { cta: "demo", location: "hero" } },
        { name: "landing_cta_clicked", properties: { cta: "demo", location: "final" } },
        { name: "landing_cta_clicked", properties: { cta: "pricing", location: "final" } },
      ],
    });
  });

  for (const contract of [
    {
      path: "/landing-old",
      linkName: "Pricing",
      destination: "/pricing",
      analytics: {
        name: "landing_cta_click",
        properties: { cta: "view_pricing", location: "hero" },
      },
      posthog: null,
    },
  ] as const) {
    test(`${contract.path} lazily preserves its provider-specific CTA event contract`, async ({ page }) => {
      const requestedTelemetryFacades: string[] = [];
      await page.route(/\/src\/services\/(analyticsService|posthogService)\.ts(?:\?.*)?$/, async (route) => {
        const service = route.request().url().includes("posthogService") ? "posthog" : "analytics";
        requestedTelemetryFacades.push(service);
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body:
            service === "analytics"
              ? `export const trackAnalyticsEvent = async (name, properties) => {
                  window.__productEventDeliveries ??= { analytics: [], posthog: [] };
                  window.__productEventDeliveries.analytics.push({ name, properties });
                };`
              : `export const capturePostHogEvent = (name, properties) => {
                  window.__productEventDeliveries ??= { analytics: [], posthog: [] };
                  window.__productEventDeliveries.posthog.push({ name, properties });
                };`,
        });
      });
      await page.addInitScript(() => {
        Object.defineProperty(window, "__productEventDeliveries", {
          configurable: true,
          value: { analytics: [], posthog: [] },
          writable: true,
        });
      });

      await page.goto(contract.path);
      const cta = page.locator("main").getByRole("link", { name: contract.linkName, exact: true }).first();
      await expect(cta).toBeVisible();
      expect(requestedTelemetryFacades).toEqual([]);

      await cta.click();
      await expect(page).toHaveURL(new RegExp(`${contract.destination}$`));
      await expect.poll(() =>
        page.evaluate(() =>
          (window as Window & {
            __productEventDeliveries?: {
              analytics: Array<{ name: string; properties: Record<string, unknown> }>;
              posthog: Array<{ name: string; properties: Record<string, unknown> }>;
            };
          }).__productEventDeliveries,
        ),
      ).toEqual({
        analytics: [contract.analytics],
        posthog: contract.posthog ? [contract.posthog] : [],
      });
      expect(requestedTelemetryFacades.sort()).toEqual(
        contract.posthog ? ["analytics", "posthog"] : ["analytics"],
      );
    });
  }

  test("loads public status without contacting Supabase directly", async ({ page }) => {
    const requestedUrls: string[] = [];
    const responseUrls: string[] = [];
    page.on("request", (request) => requestedUrls.push(request.url()));
    page.on("response", (response) => responseUrls.push(response.url()));

    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(2_000);
    await expect(page.getByRole("link", { name: "Open system status page" })).toContainText("Running");

    expect(requestedUrls.filter((url) => url.includes("/functions/system-status"))).toHaveLength(1);
    expect(requestedUrls.some((url) => /\.supabase\.(?:co|in)\//.test(url))).toBe(false);
    const forbiddenJavaScriptResponses = responseUrls.filter(forbiddenSdkResponse);
    expect(forbiddenJavaScriptResponses).toEqual([]);
    expect(responseUrls.some((url) => /\.supabase\.(?:co|in)\//.test(url))).toBe(false);
  });

  test("shows unknown after a forced status refresh times out", async ({ page }) => {
    let statusRequestCount = 0;
    let releaseFailedRequest = () => {};
    const failedRequestGate = new Promise<void>((resolve) => {
      releaseFailedRequest = resolve;
    });
    await page.route(/\/functions(?:\/v1)?\/system-status(?:\?.*)?$/, async (route) => {
      statusRequestCount += 1;
      if (statusRequestCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "operational" }),
        });
        return;
      }
      await failedRequestGate;
      await route.abort("timedout");
    });
    await page.clock.install();

    await page.goto("/");
    const statusLink = page.getByRole("link", { name: "Open system status page" });
    await expect(statusLink).toContainText("Running");
    expect(statusRequestCount).toBe(1);

    await page.clock.fastForward(300_000);
    await expect.poll(() => statusRequestCount).toBeGreaterThanOrEqual(2);
    expect(statusRequestCount).toBeLessThanOrEqual(3);
    const countBeforeVisibility = statusRequestCount;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(statusRequestCount).toBe(countBeforeVisibility);
    releaseFailedRequest();

    await expect(statusLink).toContainText("Unknown");
    await expect(statusLink.locator(".status-dot")).toHaveClass(/status-unknown/);
    expect(statusRequestCount).toBeGreaterThanOrEqual(2);
    expect(statusRequestCount).toBeLessThanOrEqual(3);
  });

  test("keeps the landing status checking copy until initial status settles", async ({ page }) => {
    let releaseInitialRequest = () => {};
    const initialRequestGate = new Promise<void>((resolve) => {
      releaseInitialRequest = resolve;
    });
    await page.route(/\/functions(?:\/v1)?\/system-status(?:\?.*)?$/, async (route) => {
      await initialRequestGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "operational" }),
      });
    });

    await page.goto("/");
    const statusLink = page.getByRole("link", { name: "Open system status page" });
    await expect(statusLink).toContainText("Checking");
    await expect(statusLink.locator(".status-dot")).toHaveClass(/status-unknown/);

    releaseInitialRequest();
    await expect(statusLink).toContainText("Running");
    await expect(statusLink.locator(".status-dot")).toHaveClass(/status-ok/);
  });

  test("shares one system status lifecycle across retained landing routes", async ({ page }) => {
    let statusRequestCount = 0;
    page.on("request", (request) => {
      if (request.url().includes("/functions/system-status")) {
        statusRequestCount += 1;
      }
    });
    await page.clock.install();
    await page.addInitScript(() => {
      const activeStatusIntervals = new Set<number>();
      const activeVisibilityListeners = new Set<EventListenerOrEventListenerObject>();
      const statusLifecycleVisibilityListeners =
        new Set<EventListenerOrEventListenerObject>();
      const wrappedVisibilityListeners = new Map<
        EventListenerOrEventListenerObject,
        EventListener
      >();
      let runningVisibilityListener: EventListenerOrEventListenerObject | null = null;
      const nativeSetInterval = window.setInterval.bind(window);
      const nativeClearInterval = window.clearInterval.bind(window);
      const nativeAddEventListener = document.addEventListener.bind(document);
      const nativeRemoveEventListener = document.removeEventListener.bind(document);
      window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        const intervalId = nativeSetInterval(handler, timeout, ...args);
        if (timeout === 300_000) {
          activeStatusIntervals.add(intervalId);
          if (runningVisibilityListener) {
            statusLifecycleVisibilityListeners.add(runningVisibilityListener);
          }
        }
        return intervalId;
      }) as typeof window.setInterval;
      window.clearInterval = ((intervalId?: number) => {
        if (typeof intervalId === "number") {
          if (activeStatusIntervals.has(intervalId) && runningVisibilityListener) {
            statusLifecycleVisibilityListeners.add(runningVisibilityListener);
          }
          activeStatusIntervals.delete(intervalId);
        }
        nativeClearInterval(intervalId);
      }) as typeof window.clearInterval;
      document.addEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) => {
        if (type === "visibilitychange" && listener) {
          activeVisibilityListeners.add(listener);
          const wrappedListener: EventListener = function (event) {
            runningVisibilityListener = listener;
            try {
              if (typeof listener === "function") {
                listener.call(this, event);
              } else {
                listener.handleEvent(event);
              }
            } finally {
              runningVisibilityListener = null;
            }
          };
          wrappedVisibilityListeners.set(listener, wrappedListener);
          nativeAddEventListener(type, wrappedListener, options);
          return;
        }
        nativeAddEventListener(type, listener, options);
      }) as typeof document.addEventListener;
      document.removeEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions,
      ) => {
        if (type === "visibilitychange" && listener) {
          activeVisibilityListeners.delete(listener);
          const wrappedListener = wrappedVisibilityListeners.get(listener);
          if (wrappedListener) {
            wrappedVisibilityListeners.delete(listener);
            statusLifecycleVisibilityListeners.delete(listener);
            nativeRemoveEventListener(type, wrappedListener, options);
            return;
          }
        }
        nativeRemoveEventListener(type, listener, options);
      }) as typeof document.removeEventListener;
      Object.defineProperty(window, "__activeSystemStatusIntervals", {
        configurable: true,
        get: () => activeStatusIntervals.size,
      });
      Object.defineProperty(window, "__activeVisibilityListeners", {
        configurable: true,
        get: () => activeVisibilityListeners.size,
      });
      Object.defineProperty(window, "__statusLifecycleVisibilityListeners", {
        configurable: true,
        get: () => statusLifecycleVisibilityListeners.size,
      });
    });
    const activeFiveMinuteIntervalCount = () =>
      page.evaluate(
        () =>
          (window as Window & { __activeSystemStatusIntervals?: number })
            .__activeSystemStatusIntervals ?? 0,
      );
    const activeVisibilityListenerCount = () =>
      page.evaluate(
        () =>
          (window as Window & { __activeVisibilityListeners?: number })
            .__activeVisibilityListeners ?? 0,
      );
    const statusLifecycleVisibilityListenerCount = () =>
      page.evaluate(
        () =>
          (window as Window & { __statusLifecycleVisibilityListeners?: number })
            .__statusLifecycleVisibilityListeners ?? 0,
      );
    const setVisibility = (visibilityState: "hidden" | "visible") =>
      page.evaluate((nextVisibilityState) => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: nextVisibilityState,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      }, visibilityState);
    const navigateWithinApp = async (path: string) => {
      await page.evaluate((nextPath) => {
        window.history.pushState({}, "", nextPath);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, path);
      await page.waitForURL(`**${path}`);
    };

    await page.goto("/");
    await expect(page.getByRole("link", { name: "Open system status page" })).toContainText(
      "Running",
    );
    expect(statusRequestCount).toBe(1);
    // App status polling and the offline-pack refresh share the five-minute cadence.
    await expect.poll(activeFiveMinuteIntervalCount).toBe(2);
    // Version, offline queue, admin session, PostHog, status, and the two
    // consent observers own distinct lifecycles.
    await expect.poll(activeVisibilityListenerCount).toBe(7);

    await page.clock.fastForward(10_001);
    await setVisibility("hidden");
    expect(statusRequestCount).toBe(1);
    await expect.poll(activeFiveMinuteIntervalCount).toBe(1);
    await expect.poll(activeVisibilityListenerCount).toBe(7);
    await expect.poll(statusLifecycleVisibilityListenerCount).toBe(1);
    await setVisibility("visible");
    await expect.poll(() => statusRequestCount).toBe(2);
    await expect.poll(activeFiveMinuteIntervalCount).toBe(2);
    await expect.poll(activeVisibilityListenerCount).toBe(7);
    await expect.poll(statusLifecycleVisibilityListenerCount).toBe(1);

    await page.clock.fastForward(100_000);
    await navigateWithinApp("/landing-old");
    await expect.poll(activeFiveMinuteIntervalCount).toBe(2);
    await expect.poll(activeVisibilityListenerCount).toBe(7);
    await expect.poll(statusLifecycleVisibilityListenerCount).toBe(1);
    await page.clock.fastForward(300_000);
    await expect.poll(() => statusRequestCount).toBe(3);

    await navigateWithinApp("/landing-new");
    await expect.poll(activeFiveMinuteIntervalCount).toBe(2);
    await expect.poll(activeVisibilityListenerCount).toBe(7);
    await expect.poll(statusLifecycleVisibilityListenerCount).toBe(1);
    await page.clock.fastForward(300_000);
    await expect.poll(() => statusRequestCount).toBe(4);
  });

  for (const path of ["/landing-old", "/login"]) {
    test(`${path} does not prefetch authenticated routes after the delayed idle window`, async ({ page }) => {
      const responseUrls: string[] = [];
      page.on("response", (response) => responseUrls.push(response.url()));
      await page.addInitScript(() => {
        Object.defineProperty(window, "requestIdleCallback", {
          configurable: true,
          value: undefined,
        });
      });
      await page.clock.install();

      await page.goto(path, { waitUntil: "networkidle" });
      await page.clock.fastForward(18_000);
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(responseUrls.filter(authenticatedRouteResponse)).toEqual([]);
      expect(responseUrls.filter(forbiddenSdkResponse)).toEqual([]);
      expect(responseUrls.some((url) => /\.supabase\.(?:co|in)\//.test(url))).toBe(false);
    });
  }

  test("cookie preferences and theme survive app-shell remounts", async ({ page }) => {
    await page.goto("/login");

    await page.getByRole("button", { name: "Accept all" }).click();
    await expect.poll(() => readCookieConsentPreferences(page)).toEqual({ analytics: true, diagnostics: true });

    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Dark Mode" }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("itemtraxx-theme"))).toBe("dark");

    await page.reload();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
    await expect(page.getByRole("button", { name: "Accept all" })).toHaveCount(0);
  });

  test("essential and custom consent synchronize through custom events", async ({ page }) => {
    await page.goto("/login");
    const consentDialog = page.getByRole("dialog", { name: "Cookie preferences" });

    await consentDialog.getByRole("button", { name: "Essential only" }).click();
    await expect.poll(() => readCookieConsentPreferences(page)).toEqual({ analytics: false, diagnostics: false });

    await clearCookieConsentCookie(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("itemtraxx:cookie-consent")));
    await expect(consentDialog).toBeVisible();

    await consentDialog.getByRole("button", { name: "Manage preferences" }).click();
    await consentDialog.getByRole("checkbox", { name: "Analytics" }).check();
    await consentDialog.getByRole("button", { name: "Save choices" }).click();
    await expect.poll(() => readCookieConsentPreferences(page)).toEqual({ analytics: true, diagnostics: false });

    await clearCookieConsentCookie(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("itemtraxx:cookie-consent")));
    await expect(consentDialog).toBeVisible();
  });

  test("broadcast dismissal and top-banner CSS offset follow the rendered banner height", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/system-status(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "operational",
          checked_at: "2026-07-13T12:00:00.000Z",
          maintenance: { enabled: false, message: "" },
          broadcast: {
            enabled: true,
            message: "Planned dashboard notice",
            level: "info",
            updated_at: "broadcast-2026-07-13",
          },
        }),
      });
    });

    await page.goto("/login");
    const banner = page.getByRole("status").filter({ hasText: "Planned dashboard notice" });
    await expect(banner).toBeVisible();
    const height = await banner.evaluate((element) => element.getBoundingClientRect().height);
    await expect.poll(() =>
      page.evaluate(() =>
        Number.parseFloat(
          getComputedStyle(document.querySelector(".app-shell") as HTMLElement)
            .getPropertyValue("--top-banner-offset"),
        ),
      ),
    ).toBeCloseTo(height, 0);

    await page.getByRole("button", { name: "Dismiss broadcast" }).click();
    await expect(banner).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("itemtraxx-broadcast-dismissed"))).toBe(
      "broadcast-2026-07-13",
    );
  });

  test("maintenance blocks non-exempt routes and preserves its cached message", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/system-status(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": nonDevE2eOrigin },
        contentType: "application/json",
        body: JSON.stringify({
          status: "degraded",
          checked_at: "2026-07-13T12:00:00.000Z",
          maintenance: {
            enabled: true,
            message: "Scheduled inventory maintenance",
            updated_at: "2026-07-13T12:00:00.000Z",
          },
        }),
      });
    });

    await page.goto(`${nonDevE2eOrigin}/login`);
    const maintenanceBanner = page.getByRole("alert").filter({
      hasText: "Scheduled inventory maintenance",
    });
    await expect(maintenanceBanner).toBeVisible();
    await expect(maintenanceBanner.locator("strong")).toHaveText("Maintenance Mode");
    await expect(maintenanceBanner.locator("span")).toHaveText(
      "Scheduled inventory maintenance",
    );
    const overlay = page.getByRole("alertdialog").filter({ hasText: "Maintenance currently in Progress" });
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole("link", { name: "View Live Status" })).toHaveAttribute(
      "href",
      "https://status.itemtraxx.com/?ref=maintscreen",
    );
    await expect.poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("itemtraxx-maintenance-state") ?? "null")),
    ).toEqual({
      enabled: true,
      message: "Scheduled inventory maintenance",
      updatedAt: "2026-07-13T12:00:00.000Z",
    });
  });

  test("kill switch keeps public home available and sends other routes to unavailable", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/system-status(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": nonDevE2eOrigin },
        contentType: "application/json",
        body: JSON.stringify({
          status: "operational",
          kill_switch: { enabled: true, message: "" },
          maintenance: { enabled: false, message: "" },
        }),
      });
    });

    await page.goto(`${nonDevE2eOrigin}/`);
    await page.evaluate(async () => {
      const { default: router } = await import("/src/router/index.ts");
      router.replace = (() => Promise.resolve()) as typeof router.replace;
    });
    await navigateApp(page, "/login");
    const overlay = page.getByRole("alertdialog").filter({ hasText: "currently unavailable" });
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole("link", { name: "View status page" })).toHaveAttribute(
      "href",
      "https://status.itemtraxx.com/?ref=killswitch",
    );
    await expect(overlay).toContainText(
      "Please see the status page (https://status.itemtraxx.com/?ref=killswitch) for more information.",
    );

    await page.goto(`${nonDevE2eOrigin}/`);
    await expect(page).toHaveURL(`${nonDevE2eOrigin}/`);
    await page.goto(`${nonDevE2eOrigin}/login`);
    await expect(page).toHaveURL(`${nonDevE2eOrigin}/unavailable`);
    await expect(page.getByRole("heading", { name: /currently unavailable/i })).toBeVisible();
  });

  test("explicit non-production hosts bypass unavailable-state presentation", async ({ page }) => {
    await page.goto("/");
    const bypasses = await page.evaluate(async () => {
      const { isUnavailableBypassHost } = await import("/src/utils/unavailableBypass.ts");
      return {
        dennis: isUnavailableBypassHost("dennis-dev.itemtraxx.com"),
        leo: isUnavailableBypassHost("leo-dev.itemtraxx.com"),
        dev: isUnavailableBypassHost("dev.itemtraxx.com"),
        preview: isUnavailableBypassHost("preview.itemtraxx.com"),
        staging: isUnavailableBypassHost("staging.itemtraxx.com"),
        production: isUnavailableBypassHost("itemtraxx.com"),
      };
    });

    expect(bypasses).toEqual({
      dennis: true,
      leo: true,
      dev: true,
      preview: true,
      staging: true,
      production: false,
    });
  });

  test("the forced version overlay preserves update copy and precedence", async ({ page }) => {
    await page.goto("/login?force-update-overlay=1");
    const overlay = page.getByRole("alertdialog").filter({ hasText: "Update Available" });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("A new version of ItemTraxx is available.");
    await expect(overlay.getByRole("button", { name: "Update" })).toBeVisible();
  });

  test("maintenance suppresses forced version and session overlays", async ({ page }) => {
    await page.route(/\/functions(?:\/v1)?\/system-status(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": nonDevE2eOrigin },
        contentType: "application/json",
        body: JSON.stringify({
          status: "degraded",
          maintenance: { enabled: true, message: "Precedence maintenance" },
        }),
      });
    });

    await page.goto(`${nonDevE2eOrigin}/login?force-update-overlay=1`);
    await page.evaluate(async () => {
      const { showSessionTermination } = await import("/src/store/sessionTermination.ts");
      showSessionTermination("/login");
    });

    const dialogs = page.getByRole("alertdialog");
    await expect(dialogs.filter({ hasText: "Maintenance currently in Progress" })).toBeVisible();
    await expect(dialogs.filter({ hasText: "Update Available" })).toHaveCount(0);
    await expect(dialogs.filter({ hasText: "Session Ended" })).toHaveCount(0);
  });

  test("forced version overlay is gated to development E2E builds", async () => {
    const source = await readFile(
      new URL("../../src/composables/useAppVersionStatus.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('import.meta.env.VITE_E2E_TEST_UTILS === "true"');
    expect(source).toMatch(/import\.meta\.env\.DEV[\s\S]*VITE_E2E_TEST_UTILS[\s\S]*force-update-overlay/);
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
