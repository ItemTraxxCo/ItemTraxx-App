import { expect, test } from "@playwright/test";
import {
  mockAdminOps,
  mockSuperDashboard,
  mockSuperGearMutate,
  mockSuperTenantMutate,
  mockSystemStatus,
  mockUnauthenticatedSession,
  navigateApp,
  setSuperAdminSession,
  setTenantAdminSession,
} from "./helpers/testHarness";

test.describe("global CSS ownership contracts", () => {
  test.beforeEach(async ({ page }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
    await mockAdminOps(page);
    await mockSuperDashboard(page);
    await mockSuperTenantMutate(page);
    await mockSuperGearMutate(page);
  });

  test("authenticated CSS is absent from public startup and resolves before protected UI", async ({
    page,
  }) => {
    const authenticatedCssRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith("/src/styles/authenticated.css")) {
        authenticatedCssRequests.push(request.url());
      }
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "ItemTraxx", exact: true })).toBeVisible();
    expect(authenticatedCssRequests).toEqual([]);

    await setTenantAdminSession(page);
    await navigateApp(page, "/tenant/admin");
    await expect(page.getByRole("heading", { name: "Admin Panel", exact: true })).toBeVisible();
    await expect.poll(() => authenticatedCssRequests.length).toBe(1);
    expect(
      await page.locator(".admin-grid").evaluate((element) => getComputedStyle(element).display),
    ).toBe("grid");
  });

  test("protected tables retain horizontal overflow and mobile navigation stays fixed", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await setSuperAdminSession(page);
    await navigateApp(page, "/super-admin/tenants");

    const tableWrap = page.locator(".table-wrap");
    await expect(tableWrap).toBeVisible();
    await expect
      .poll(() =>
        tableWrap.evaluate((element) => ({
          clientWidth: element.clientWidth,
          overflowX: getComputedStyle(element).overflowX,
          scrollWidth: element.scrollWidth,
        })),
      )
      .toMatchObject({ overflowX: "auto" });
    const tableMetrics = await tableWrap.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(tableMetrics.scrollWidth).toBeGreaterThan(tableMetrics.clientWidth);

    const menu = page.locator(".top-menu");
    await expect(menu).toBeVisible();
    expect(await menu.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
    await page.getByRole("button", { name: "Open menu" }).click();
    const dropdown = page.getByRole("menu");
    await expect(dropdown).toBeVisible();
    const dropdownBox = await dropdown.boundingBox();
    expect(dropdownBox).not.toBeNull();
    expect(dropdownBox!.x).toBeGreaterThanOrEqual(0);
    expect(dropdownBox!.x + dropdownBox!.width).toBeLessThanOrEqual(390);
  });

  test("reduced motion disables authenticated skeleton shimmer", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route(/\/functions(?:\/v1)?\/super-gear-mutate(?:\?.*)?$/, async (route) => {
      const body = (route.request().postDataJSON() as { action?: string }) ?? {};
      if (body.action !== "list") {
        await route.fallback();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.goto("/");
    await setSuperAdminSession(page);
    await navigateApp(page, "/super-admin/gear");

    const skeleton = page.getByRole("status", { name: "Loading all items" });
    await expect(skeleton).toBeVisible();
    const animationName = await skeleton.locator(".skeleton-line").first().evaluate((element) =>
      getComputedStyle(element, "::after").animationName
    );
    expect(animationName).toBe("none");
  });
});
