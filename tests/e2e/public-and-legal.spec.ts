import { expect, test } from "@playwright/test";
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

test.describe("Public surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
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
    // App and PostHog each own an unrelated listener; status owns the third.
    await expect.poll(activeVisibilityListenerCount).toBe(3);

    await page.clock.fastForward(10_001);
    await setVisibility("hidden");
    expect(statusRequestCount).toBe(1);
    await expect.poll(activeStatusIntervalCount).toBe(0);
    await expect.poll(activeVisibilityListenerCount).toBe(3);
    await expect.poll(statusLifecycleVisibilityListenerCount).toBe(1);
    await setVisibility("visible");
    await expect.poll(() => statusRequestCount).toBe(2);
    await expect.poll(activeStatusIntervalCount).toBe(1);
    await expect.poll(activeVisibilityListenerCount).toBe(3);
    await expect.poll(statusLifecycleVisibilityListenerCount).toBe(1);

    await page.clock.fastForward(100_000);
    await navigateWithinApp("/landing-old");
    await expect.poll(activeStatusIntervalCount).toBe(1);
    await expect.poll(activeVisibilityListenerCount).toBe(3);
    await expect.poll(statusLifecycleVisibilityListenerCount).toBe(1);
    await page.clock.fastForward(300_000);
    await expect.poll(() => statusRequestCount).toBe(3);

    await navigateWithinApp("/landing-new2");
    await expect.poll(activeStatusIntervalCount).toBe(1);
    await expect.poll(activeVisibilityListenerCount).toBe(3);
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
