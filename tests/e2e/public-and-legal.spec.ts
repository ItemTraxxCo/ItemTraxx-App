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
      const nativeSetInterval = window.setInterval.bind(window);
      const nativeClearInterval = window.clearInterval.bind(window);
      window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        const intervalId = nativeSetInterval(handler, timeout, ...args);
        if (timeout === 300_000) {
          activeStatusIntervals.add(intervalId);
        }
        return intervalId;
      }) as typeof window.setInterval;
      window.clearInterval = ((intervalId?: number) => {
        if (typeof intervalId === "number") {
          activeStatusIntervals.delete(intervalId);
        }
        nativeClearInterval(intervalId);
      }) as typeof window.clearInterval;
      Object.defineProperty(window, "__activeSystemStatusIntervals", {
        configurable: true,
        get: () => activeStatusIntervals.size,
      });
    });
    const activeStatusIntervalCount = () =>
      page.evaluate(
        () =>
          (window as Window & { __activeSystemStatusIntervals?: number })
            .__activeSystemStatusIntervals ?? 0,
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

    await page.clock.fastForward(10_001);
    await setVisibility("hidden");
    expect(statusRequestCount).toBe(1);
    await expect.poll(activeStatusIntervalCount).toBe(0);
    await setVisibility("visible");
    await expect.poll(() => statusRequestCount).toBe(2);
    await expect.poll(activeStatusIntervalCount).toBe(1);

    await page.clock.fastForward(100_000);
    await navigateWithinApp("/landing-old");
    await expect.poll(activeStatusIntervalCount).toBe(1);
    await page.clock.fastForward(300_000);
    await expect.poll(() => statusRequestCount).toBe(3);

    await navigateWithinApp("/landing-new2");
    await expect.poll(activeStatusIntervalCount).toBe(1);
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
