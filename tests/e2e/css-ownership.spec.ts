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

  test("single-route admin styles retain their scoped visual contracts", async ({ page }) => {
    const hasScopedRule = (className: string) =>
      page.evaluate((targetClass) => {
        for (const sheet of document.styleSheets) {
          let rules: CSSRuleList;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of Array.from(rules)) {
            if (
              rule instanceof CSSStyleRule &&
              rule.selectorText.includes(`.${targetClass}[data-v-`)
            ) {
              return true;
            }
          }
        }
        return false;
      }, className);

    await page.route("**/rest/v1/**", async (route) => {
      const request = route.request();
      if (request.method() === "HEAD") {
        await route.fulfill({ status: 200, headers: { "content-range": "0-0/7" } });
        return;
      }
      if (new URL(request.url()).pathname.endsWith("/rest/v1/gear")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: "gear-css-owner",
              tenant_id: "tenant-e2e",
              name: "CSS owner camera",
              barcode: "CSS-OWNER-1",
              serial_number: "SERIAL-1",
              status: "available",
              notes: "Route-owned note",
            },
          ]),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.route(/\/functions(?:\/v1)?\/admin-gear-mutate(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.goto("/");
    await page.evaluate(() => {
      window.localStorage.setItem("itemtraxx:onboarding:v1:tenant_admin", new Date().toISOString());
      window.localStorage.setItem(
        "itemtraxx-cookie-consent",
        JSON.stringify({
          version: 2,
          preferences: { analytics: false, diagnostics: false },
          updatedAt: new Date().toISOString(),
        }),
      );
    });
    await setTenantAdminSession(page);

    await navigateApp(page, "/tenant/admin");
    const adminCard = page.getByRole("link", { name: /Item Management/ });
    await expect(adminCard).toBeVisible();
    expect(
      await adminCard.evaluate((element) => {
        const style = getComputedStyle(element);
        return { display: style.display, borderRadius: style.borderRadius };
      }),
    ).toEqual({ display: "block", borderRadius: "14px" });
    expect(await hasScopedRule("admin-card")).toBe(true);

    await navigateApp(page, "/tenant/admin/stats");
    const statsGrid = page.locator(".stats-grid");
    await expect(statsGrid).toBeVisible();
    expect(await statsGrid.evaluate((element) => getComputedStyle(element).display)).toBe("grid");
    expect(await hasScopedRule("stats-grid")).toBe(true);

    await navigateApp(page, "/tenant/admin/gear");
    const formHelp = page.locator(".form-help-row").first();
    await expect(formHelp).toBeVisible();
    expect(
      await formHelp.evaluate((element) => {
        const style = getComputedStyle(element);
        return { display: style.display, justifyContent: style.justifyContent };
      }),
    ).toEqual({ display: "flex", justifyContent: "space-between" });
    expect(await hasScopedRule("form-help-row")).toBe(true);

    const notesCell = page.locator(".gear-notes-cell");
    await expect(notesCell).toHaveText("Route-owned note");
    expect(await notesCell.evaluate((element) => getComputedStyle(element).minWidth)).toBe("220px");
    expect(await hasScopedRule("gear-notes-cell")).toBe(true);

    await page.getByRole("button", { name: "Details" }).click();
    const notesInput = page.locator(".gear-notes-input");
    await expect(notesInput).toBeVisible();
    expect(await notesInput.evaluate((element) => getComputedStyle(element).width)).toBe(
      `${await notesInput.evaluate((element) => element.parentElement?.clientWidth ?? 0)}px`,
    );
    expect(await hasScopedRule("gear-notes-input")).toBe(true);
  });
});
