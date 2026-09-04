import { expect, test } from "@playwright/test";
import {
  mockAdminOps,
  mockSystemStatus,
  mockUnauthenticatedSession,
  navigateApp,
  setWorkspaceAdminSession,
} from "./helpers/testHarness";

test.describe("Checkout borrower ownership regression", () => {
  test("checkout by borrower A, borrower B blocked, return by borrower A allowed", async ({
    page,
  }) => {
    await mockSystemStatus(page);
    await mockUnauthenticatedSession(page);
    await mockAdminOps(page);

    let checkedOutBy: string | null = null;
    const borrowerByBorrowerId: Record<string, { id: string; username: string; borrower_id: string }> = {
      BRWRA: { id: "borrower-a", username: "Borrower A", borrower_id: "BRWRA" },
      BRWRB: { id: "borrower-b", username: "Borrower B", borrower_id: "BRWRB" },
    };

    let directBorrowerLookupAttempted = false;
    await page.route("**/rest/v1/borrowers?**", async (route) => {
      directBorrowerLookupAttempted = true;
      await route.fulfill({ status: 403, contentType: "application/json", body: "[]" });
    });

    await page.route(/\/functions(?:\/v1)?\/checkout-borrower-lookup(?:\?.*)?$/, async (route) => {
      const body = route.request().postDataJSON() as { borrower_id: string };
      const borrowerId = body.borrower_id;
      const row = borrowerByBorrowerId[borrowerId];
      await route.fulfill({
        status: row ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(row ? { data: row } : { error: "Borrower not found" }),
      });
    });

    await page.route("**/rest/v1/items?**", async (route) => {
      const url = new URL(route.request().url());
      const barcodeFilter = url.searchParams.get("barcode");
      const checkedOutByFilter = url.searchParams.get("checked_out_by");
      const checkedOutByBorrower = checkedOutByFilter?.replace("eq.", "") ?? "";

      const itemRow = {
        id: "item-1",
        name: "Camera A",
        barcode: "ITEM-1",
        status: checkedOutBy ? "checked_out" : "available",
      };

      if (barcodeFilter) {
        const barcode = barcodeFilter.replace("eq.", "");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(barcode === "ITEM-1" ? [itemRow] : []),
        });
        return;
      }

      if (checkedOutByFilter) {
        if (checkedOutByBorrower === "borrower-b" && checkedOutBy === "borrower-a") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([{
              id: "item-2",
              name: "Laptop B",
              barcode: "ITEM-2",
              status: "checked_out",
              checked_out_by: "borrower-b",
            }]),
          });
          return;
        }
        const rows = checkedOutBy === checkedOutByBorrower ? [itemRow] : [];
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
        borrower_id: string;
        item_barcodes: string[];
      };
      const borrowerId = body.borrower_id;
      const barcode = body.item_barcodes[0];

      if (barcode !== "ITEM-1") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, processed: 0, skipped_barcodes: [barcode] }),
        });
        return;
      }

      if (!checkedOutBy) {
        checkedOutBy = borrowerByBorrowerId[borrowerId]?.id ?? null;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, processed: 1, skipped_barcodes: [] }),
        });
        return;
      }

      if (checkedOutBy === borrowerByBorrowerId[borrowerId]?.id) {
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
      window.localStorage.setItem("itemtraxx:onboarding:v1:tenant_account", new Date().toISOString());
      window.localStorage.setItem("itemtraxx:onboarding:v1:workspace_admin", new Date().toISOString());
      window.localStorage.setItem(
        "itemtraxx-cookie-consent",
        JSON.stringify({
          version: 2,
          preferences: { analytics: true, diagnostics: true },
          updatedAt: new Date().toISOString(),
        })
      );
    });
    await setWorkspaceAdminSession(page, "tenant-e2e");
    await navigateApp(page, "/checkout");
    await expect(page).toHaveURL(/\/checkout$/);

    const consentButton = page.getByRole("button", { name: "Essential only" });
    if (await consentButton.isVisible()) await consentButton.click();

    const borrowerInput = page.getByPlaceholder("Enter borrower ID");
    const loadBorrowerButton = page.getByRole("button", { name: "Load borrower" });
    const barcodeInput = page.getByPlaceholder("Scan or enter barcode");
    const addBarcodeButton = page.getByRole("button", { name: "Add barcode" });
    const completeTransactionButton = page.getByRole("button", { name: "Complete transaction" });
    const loadBorrower = async (id: "BRWRA" | "BRWRB") => {
      await borrowerInput.fill(id);
      await loadBorrowerButton.click();
      await expect(page.locator(".checkout-borrower-summary")).toBeVisible();
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
    await expect(borrowerInput).toBeFocused();

    // 2) Borrower B cannot return A's item even though B has another item checked out.
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
    expect(directBorrowerLookupAttempted).toBe(false);
  });
});
