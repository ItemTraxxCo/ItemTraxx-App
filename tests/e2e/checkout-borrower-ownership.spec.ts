import { expect, test } from "@playwright/test";
import {
  mockAdminOps,
  mockSystemStatus,
  navigateApp,
  setTenantAdminSession,
} from "./helpers/testHarness";

test.describe("Checkout borrower ownership regression", () => {
  test("checkout by borrower A, borrower B blocked, return by borrower A allowed", async ({
    page,
  }) => {
    await mockSystemStatus(page);
    await mockAdminOps(page);

    let checkedOutBy: string | null = null;
    const borrowerByStudentId: Record<string, { id: string; username: string; student_id: string }> = {
      BRWRA: { id: "student-a", username: "Borrower A", student_id: "BRWRA" },
      BRWRB: { id: "student-b", username: "Borrower B", student_id: "BRWRB" },
    };

    await page.route("**/rest/v1/students?**", async (route) => {
      const url = new URL(route.request().url());
      const studentIdFilter = url.searchParams.get("student_id");
      const studentId = studentIdFilter?.replace("eq.", "") ?? "";
      const row = borrowerByStudentId[studentId];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(row ? [row] : []),
      });
    });

    await page.route("**/rest/v1/gear?**", async (route) => {
      const url = new URL(route.request().url());
      const barcodeFilter = url.searchParams.get("barcode");
      const checkedOutByFilter = url.searchParams.get("checked_out_by");
      const checkedOutByStudent = checkedOutByFilter?.replace("eq.", "") ?? "";

      const gearRow = {
        id: "gear-1",
        name: "Camera A",
        barcode: "ITEM-1",
        status: checkedOutBy ? "checked_out" : "available",
      };

      if (barcodeFilter) {
        const barcode = barcodeFilter.replace("eq.", "");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(barcode === "ITEM-1" ? [gearRow] : []),
        });
        return;
      }

      if (checkedOutByFilter) {
        const rows = checkedOutBy === checkedOutByStudent ? [gearRow] : [];
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(rows),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route(/\/functions(?:\/v1)?\/checkoutReturn(?:\?.*)?$/, async (route) => {
      const body = route.request().postDataJSON() as {
        student_id: string;
        gear_barcodes: string[];
      };
      const borrowerId = body.student_id;
      const barcode = body.gear_barcodes[0];

      if (barcode !== "ITEM-1") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, processed: 0, skipped_barcodes: [barcode] }),
        });
        return;
      }

      if (!checkedOutBy) {
        checkedOutBy = borrowerByStudentId[borrowerId]?.id ?? null;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, processed: 1, skipped_barcodes: [] }),
        });
        return;
      }

      if (checkedOutBy === borrowerByStudentId[borrowerId]?.id) {
        checkedOutBy = null;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, processed: 1, skipped_barcodes: [] }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, processed: 0, skipped_barcodes: ["ITEM-1"] }),
      });
    });

    await page.goto("/");
    await page.evaluate(() => {
      window.localStorage.setItem("itemtraxx:onboarding:v1:tenant_user", new Date().toISOString());
      window.localStorage.setItem("itemtraxx:onboarding:v1:tenant_admin", new Date().toISOString());
      window.localStorage.setItem(
        "itemtraxx-cookie-consent",
        JSON.stringify({
          version: 1,
          choice: "all",
          updatedAt: new Date().toISOString(),
        })
      );
    });
    await setTenantAdminSession(page, "tenant-e2e");
    await navigateApp(page, "/tenant/checkout");
    await expect(page).toHaveURL(/\/tenant\/checkout$/);

    const borrowerInput = page.getByPlaceholder("Enter borrower ID");
    const loadBorrowerButton = page.getByRole("button", { name: "Load borrower" });
    const barcodeInput = page.getByPlaceholder("Scan or enter barcode");
    const addBarcodeButton = page.getByRole("button", { name: "Add barcode" });
    const completeTransactionButton = page.getByRole("button", { name: "Complete transaction" });
    const loadBorrower = async (id: "BRWRA" | "BRWRB") => {
      await borrowerInput.fill(id);
      await loadBorrowerButton.click();
      await expect(page.locator(".checkout-student-summary")).toBeVisible();
      await expect(page.getByText(`ID: ${id}`)).toBeVisible();
      await expect(barcodeInput).toBeVisible();
    };

    // 1) Checkout by borrower A.
    await loadBorrower("BRWRA");
    await barcodeInput.fill("ITEM-1");
    await addBarcodeButton.click();
    await expect(page.locator(".tag-checkout", { hasText: "Checkout" })).toBeVisible();
    await completeTransactionButton.click();
    await expect(page.getByText("Transaction complete (Success).")).toBeVisible();

    // 2) Borrower B cannot checkout/return while item is checked out by A.
    await loadBorrower("BRWRB");
    await barcodeInput.fill("ITEM-1");
    await addBarcodeButton.click();
    await expect(page.locator(".error", { hasText: "Item already checked out." })).toBeVisible();

    // 3) Borrower A can return their own checked-out item.
    await loadBorrower("BRWRA");
    await barcodeInput.fill("ITEM-1");
    await addBarcodeButton.click();
    await expect(page.locator(".tag-return", { hasText: "Return" })).toBeVisible();
    await completeTransactionButton.click();
    await expect(page.getByText("Transaction complete (Success).")).toBeVisible();
  });
});
