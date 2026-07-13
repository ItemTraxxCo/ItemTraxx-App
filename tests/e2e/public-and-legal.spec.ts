import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { mockSystemStatus, mockUnauthenticatedSession } from "./helpers/testHarness";

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
  return pathname.includes("/tenant/checkout.vue") || pathname.includes("/tenant/admin/adminlogin.vue");
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
    test(`canonical landing preserves its semantic, image, and responsive contracts on ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(() => {
        Math.random = () => 0;
      });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "ItemTraxx", exact: true })).toBeVisible();

      const headings = await page.getByRole("heading").evaluateAll((elements) =>
        elements.map((element) => ({
          level: Number(element.tagName.slice(1)),
          name: element.textContent?.trim() ?? "",
        })),
      );
      expect(headings).toEqual([
        { level: 1, name: "ItemTraxx" },
        { level: 2, name: "Simple inventory tracking without spreadsheet headaches." },
        { level: 2, name: "Simple UI keeps everything minimal, sleek, and easy to navigate." },
        { level: 3, name: "Management workflows without the spreadsheet sprawl." },
        { level: 3, name: "Master your inventory." },
        { level: 3, name: "Built for teams, organizations, and individual users." },
        { level: 2, name: "Answers to the common stuff." },
        { level: 2, name: "Get started with ItemTraxx and advance your inventory management." },
      ]);

      const primaryNav = page.getByRole("navigation", { name: "Primary" });
      await expect(primaryNav.getByRole("link", { name: "Pricing", exact: true })).toHaveAttribute("href", "/pricing");
      await expect(primaryNav.getByRole("link", { name: "Support", exact: true })).toHaveAttribute("href", "/contact-support");
      await expect(primaryNav.getByRole("link", { name: "Open system status page" })).toHaveAttribute("href", "https://status.itemtraxx.com/");
      await expect(primaryNav.getByRole("link", { name: "Open system status page" })).toHaveAttribute("target", "_blank");
      await expect(primaryNav.getByRole("link", { name: "Open system status page" })).toHaveAttribute("rel", "noreferrer");
      await expect(primaryNav.getByRole("link", { name: "Login", exact: true })).toHaveAttribute("href", "/login");

      const hero = page.locator("section.hero-grid");
      await expect(hero.getByRole("link", { name: "Pricing", exact: true })).toHaveAttribute("href", "/pricing");
      await expect(hero.getByRole("link", { name: "Request Demo", exact: true })).toHaveAttribute("href", "/request-demo");
      await expect(hero.getByRole("list", { name: "Key product benefits" }).getByRole("listitem")).toHaveCount(6);

      const images = page.locator("main img");
      await expect(images).toHaveCount(2);
      await expect(images.nth(0)).toHaveAttribute("alt", "Checkout and return interface preview");
      await expect(images.nth(0)).toHaveAttribute("src", /checkout_return_ui\.png$/);
      await expect(images.nth(0)).toHaveAttribute("loading", "lazy");
      await expect(images.nth(0)).toHaveAttribute("decoding", "async");
      await expect(images.nth(0)).toHaveAttribute("width", "1600");
      await expect(images.nth(0)).toHaveAttribute("height", "810");
      await expect(images.nth(1)).toHaveAttribute("alt", "Admin interface preview");
      await expect(images.nth(1)).toHaveAttribute("src", /admin_ui\.png$/);
      await expect(images.nth(1)).toHaveAttribute("loading", "lazy");
      await expect(images.nth(1)).toHaveAttribute("decoding", "async");
      await expect(images.nth(1)).toHaveAttribute("width", "1600");
      await expect(images.nth(1)).toHaveAttribute("height", "934");
      const imageSources = page.locator("main picture source");
      await expect(imageSources.nth(0)).toHaveAttribute("type", "image/webp");
      await expect(imageSources.nth(0)).toHaveAttribute("sizes", "(max-width: 900px) 92vw, 640px");
      await expect(imageSources.nth(0)).toHaveAttribute(
        "srcset",
        /checkout_return_ui-800\.webp 800w, .*checkout_return_ui-1200\.webp 1200w, .*checkout_return_ui-1600\.webp 1600w/,
      );
      await expect(imageSources.nth(1)).toHaveAttribute("type", "image/webp");
      await expect(imageSources.nth(1)).toHaveAttribute("sizes", "(max-width: 900px) 92vw, 700px");
      await expect(imageSources.nth(1)).toHaveAttribute(
        "srcset",
        /admin_ui-800\.webp 800w, .*admin_ui-1200\.webp 1200w, .*admin_ui-1600\.webp 1600w/,
      );

      const faqToggle = page.getByRole("button", { name: "How quickly can I get started?" });
      const faqAnswer = page.locator("#landing-new-faq-answer-0");
      await expect(faqToggle).toHaveAttribute("id", "landing-new-faq-toggle-0");
      await expect(faqToggle).toHaveAttribute("aria-controls", "landing-new-faq-answer-0");
      await expect(faqToggle).toHaveAttribute("aria-expanded", "false");
      await expect(faqAnswer).toHaveAttribute("role", "region");
      await expect(faqAnswer).toHaveAttribute("aria-labelledby", "landing-new-faq-toggle-0");
      await faqToggle.click();
      await expect(faqToggle).toHaveAttribute("aria-expanded", "true");
      await expect(faqAnswer).toHaveClass(/is-open/);
      await expect(faqAnswer).toContainText("You can get started with ItemTraxx fast.");
      await faqToggle.click();
      await expect(faqToggle).toHaveAttribute("aria-expanded", "false");
      await expect(faqAnswer).not.toHaveClass(/is-open/);

      const finalCta = page.locator("section.final-strip");
      await expect(finalCta.getByRole("link", { name: "Go to Login" })).toHaveAttribute("href", "/login");
      await expect(finalCta.getByRole("link", { name: "Pricing", exact: true })).toHaveAttribute("href", "/pricing");
      const footer = page.locator("footer.public-footer");
      await expect(footer.getByRole("link", { name: "Contact Support" })).toHaveAttribute("href", "/contact-support");
      await expect(footer.getByRole("link", { name: "Status", exact: true })).toHaveAttribute("href", "https://status.itemtraxx.com/");

      const responsiveContract = await page.evaluate(() => {
        const styles = (selector: string) => getComputedStyle(document.querySelector(selector) as HTMLElement);
        return {
          heroColumns: styles(".hero-grid").gridTemplateColumns.split(" ").length,
          opsColumns: styles(".ops-grid").gridTemplateColumns.split(" ").length,
          heroPadding: styles(".hero-copy").padding,
          heroRadius: styles(".hero-copy").borderRadius,
          headerDirection: styles(".landing-header").flexDirection,
          navOverflow: styles(".landing-nav").overflowX,
        };
      });
      expect(responsiveContract).toEqual(
        viewport.label === "desktop"
          ? {
              heroColumns: 2,
              opsColumns: 3,
              heroPadding: "48px",
              heroRadius: "28px",
              headerDirection: "row",
              navOverflow: "visible",
            }
          : {
              heroColumns: 1,
              opsColumns: 1,
              heroPadding: "19.2px",
              heroRadius: "22px",
              headerDirection: "row",
              navOverflow: "auto",
            },
      );
    });
  }

  test("canonical page composes focused landing section boundaries without moving integrations", async () => {
    const pageSource = await readFile(
      new URL("../../src/pages/LandingPageNew.vue", import.meta.url),
      "utf8",
    );
    const sectionNames = [
      "LandingHeader",
      "LandingHero",
      "LandingShowcase",
      "LandingFeatureSections",
      "LandingFaq",
      "LandingFinalCta",
    ];

    for (const sectionName of sectionNames) {
      expect(pageSource).toContain(`../components/landing/${sectionName}.vue`);
    }
    expect(pageSource).toContain('import { trackProductEvent } from "../services/productEvents"');
    expect(pageSource).toContain("const openFaqIndex = ref<number | null>(null)");
    expect(pageSource).not.toContain('<header class="landing-header shell">');
    expect(pageSource).not.toContain('<section class="feature-band reveal reveal-up">');
    expect(pageSource).not.toContain('<section class="faq-section reveal reveal-up">');
    expect(pageSource).not.toContain('<section class="final-strip reveal reveal-up">');

    const sectionSources = await Promise.all(
      sectionNames.map((sectionName) =>
        readFile(
          new URL(`../../src/components/landing/${sectionName}.vue`, import.meta.url),
          "utf8",
        ),
      ),
    );
    for (const sectionSource of sectionSources) {
      expect(sectionSource).not.toMatch(/from ["']vue-router["']/);
      expect(sectionSource).not.toMatch(/from ["'][^"']*(?:services|stores?|auth)[^"']*["']/);
    }
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

    await page.goto("/landing-new2");
    expect(await footerContract()).toEqual(canonicalFooter);
  });

  test("the canonical landing demo CTA navigates to the demo request", async ({ page }) => {
    await page.goto("/");

    await page.locator("main").getByRole("link", { name: "Request Demo", exact: true }).click();

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
      { locator: page.locator(".hero-actions").getByRole("link", { name: "Request Demo", exact: true }), destination: "/request-demo" },
      { locator: page.locator(".final-actions").getByRole("link", { name: "Go to Login" }), destination: "/login" },
      { locator: page.locator(".final-actions").getByRole("link", { name: "Pricing", exact: true }), destination: "/pricing" },
    ];
    for (const { locator, destination } of ctas) {
      await locator.click();
      await expect(page).toHaveURL(new RegExp(`${destination}$`));
      await page.goBack();
      await expect(page.getByRole("heading", { name: "ItemTraxx", exact: true })).toBeVisible();
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
        { name: "landing_new_cta_click", properties: { cta: "login", location: "final" } },
        { name: "landing_new_cta_click", properties: { cta: "pricing", location: "final" } },
      ],
      posthog: [
        { name: "landing_cta_clicked", properties: { cta: "login", location: "header" } },
        { name: "landing_cta_clicked", properties: { cta: "pricing", location: "hero" } },
        { name: "landing_cta_clicked", properties: { cta: "demo", location: "hero" } },
        { name: "landing_cta_clicked", properties: { cta: "login", location: "final" } },
        { name: "landing_cta_clicked", properties: { cta: "pricing", location: "final" } },
      ],
    });
  });

  for (const contract of [
    {
      path: "/landing-new2",
      linkName: "Request Demo",
      destination: "/request-demo",
      analytics: {
        name: "landing_new2_cta_click",
        properties: { cta: "demo", location: "hero" },
      },
      posthog: {
        name: "landing_cta_clicked",
        properties: { cta: "demo", location: "hero", page: "landing-new2" },
      },
    },
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
    await expect.poll(() => statusRequestCount).toBe(2);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(statusRequestCount).toBe(2);
    releaseFailedRequest();

    await expect(statusLink).toContainText("Unknown");
    await expect(statusLink.locator(".status-dot")).toHaveClass(/status-unknown/);
    expect(statusRequestCount).toBe(2);
  });

  test("keeps the landing-new2 checking copy until initial status settles", async ({ page }) => {
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

    await page.goto("/landing-new2");
    const statusLink = page.getByRole("link", { name: "Open ItemTraxx system status" });
    await expect(statusLink).toContainText("Checking");
    await expect(statusLink.locator(".lp-status__dot")).toHaveClass(/status-unknown/);

    releaseInitialRequest();
    await expect(statusLink).toContainText("Running");
    await expect(statusLink.locator(".lp-status__dot")).toHaveClass(/status-ok/);
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
    const activeStatusIntervalCount = () =>
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
    await expect.poll(activeStatusIntervalCount).toBe(1);
    // Version, offline queue, admin session, PostHog, and status own distinct lifecycles.
    await expect.poll(activeVisibilityListenerCount).toBe(5);

    await page.clock.fastForward(10_001);
    await setVisibility("hidden");
    expect(statusRequestCount).toBe(1);
    await expect.poll(activeStatusIntervalCount).toBe(0);
    await expect.poll(activeVisibilityListenerCount).toBe(5);
    await expect.poll(statusLifecycleVisibilityListenerCount).toBe(1);
    await setVisibility("visible");
    await expect.poll(() => statusRequestCount).toBe(2);
    await expect.poll(activeStatusIntervalCount).toBe(1);
    await expect.poll(activeVisibilityListenerCount).toBe(5);
    await expect.poll(statusLifecycleVisibilityListenerCount).toBe(1);

    await page.clock.fastForward(100_000);
    await navigateWithinApp("/landing-old");
    await expect.poll(activeStatusIntervalCount).toBe(1);
    await expect.poll(activeVisibilityListenerCount).toBe(5);
    await expect.poll(statusLifecycleVisibilityListenerCount).toBe(1);
    await page.clock.fastForward(300_000);
    await expect.poll(() => statusRequestCount).toBe(3);

    await navigateWithinApp("/landing-new2");
    await expect.poll(activeStatusIntervalCount).toBe(1);
    await expect.poll(activeVisibilityListenerCount).toBe(5);
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
    await expect.poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("itemtraxx-cookie-consent") ?? "null")?.preferences,
      ),
    ).toEqual({ analytics: true, diagnostics: true });

    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Dark Mode" }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("itemtraxx-theme"))).toBe("dark");

    await page.reload();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
    await expect(page.getByRole("button", { name: "Accept all" })).toHaveCount(0);
  });

  test("essential and custom consent synchronize through storage and custom events", async ({ page }) => {
    await page.goto("/login");
    const consentDialog = page.getByRole("dialog", { name: "Cookie preferences" });

    await consentDialog.getByRole("button", { name: "Essential only" }).click();
    await expect.poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("itemtraxx-cookie-consent") ?? "null")?.preferences,
      ),
    ).toEqual({ analytics: false, diagnostics: false });

    await page.evaluate(() => {
      localStorage.removeItem("itemtraxx-cookie-consent");
      window.dispatchEvent(new StorageEvent("storage", { key: "itemtraxx-cookie-consent" }));
    });
    await expect(consentDialog).toBeVisible();

    await consentDialog.getByRole("checkbox", { name: "Analytics" }).check();
    await consentDialog.getByRole("button", { name: "Save choices" }).click();
    await expect.poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("itemtraxx-cookie-consent") ?? "null")?.preferences,
      ),
    ).toEqual({ analytics: true, diagnostics: false });

    await page.evaluate(() => {
      localStorage.removeItem("itemtraxx-cookie-consent");
      window.dispatchEvent(new CustomEvent("itemtraxx:cookie-consent"));
    });
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
          kill_switch: { enabled: true, message: "Emergency maintenance" },
          maintenance: { enabled: false, message: "" },
        }),
      });
    });

    await page.goto(`${nonDevE2eOrigin}/`);
    await expect(page).toHaveURL(`${nonDevE2eOrigin}/`);
    await page.goto(`${nonDevE2eOrigin}/login`);
    await expect(page).toHaveURL(`${nonDevE2eOrigin}/unavailable`);
    await expect(page.getByRole("heading", { name: /currently unavailable/i })).toBeVisible();
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
