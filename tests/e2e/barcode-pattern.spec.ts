import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { BarcodePattern } from "../../src/services/barcodePdfService";
import { mockUnauthenticatedSession } from "./helpers/testHarness";

const generatePattern = async (page: Page, value: string): Promise<BarcodePattern> => {
  await page.waitForFunction(
    () => typeof window.__itemtraxxTest?.generateBarcodePattern === "function"
  );
  return page.evaluate(
    (input) => window.__itemtraxxTest!.generateBarcodePattern(input),
    value
  );
};

test.describe("createBarcodePattern", () => {
  test.beforeEach(async ({ page }) => {
    await mockUnauthenticatedSession(page);
    await page.goto("/");
  });

  test("produces vector bars for a typical barcode", async ({ page }) => {
    const pattern = await generatePattern(page, "ITX-12345");

    expect(pattern.modules).toBeGreaterThan(0);
    expect(pattern.bars.length).toBeGreaterThan(0);

    // CODE128 always opens with a bar (the start quiet zone is stripped because
    // we render with margin: 0), so the first run must begin at module 0.
    expect(pattern.bars[0].start).toBe(0);

    // Every run must be a positive-width slice that stays inside the module grid.
    for (const bar of pattern.bars) {
      expect(bar.width).toBeGreaterThan(0);
      expect(bar.start).toBeGreaterThanOrEqual(0);
      expect(bar.start + bar.width).toBeLessThanOrEqual(pattern.modules);
    }

    // Runs must be ordered and non-overlapping.
    for (let i = 1; i < pattern.bars.length; i += 1) {
      const prev = pattern.bars[i - 1];
      expect(pattern.bars[i].start).toBeGreaterThanOrEqual(prev.start + prev.width);
    }
  });

  test("is deterministic for the same value", async ({ page }) => {
    const first = await generatePattern(page, "ABC-987");
    const second = await generatePattern(page, "ABC-987");
    expect(second).toEqual(first);
  });

  test("encodes different values differently", async ({ page }) => {
    const a = await generatePattern(page, "AAAA0001");
    const b = await generatePattern(page, "ZZZZ9999");
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
