import { describe, expect, it } from "vitest";
import { formatActionLabel } from "./actionLabel";

describe("formatActionLabel", () => {
  it.each([
    ["checkout", "Checkout"],
    ["return", "Return"],
    ["admin_return", "Admin return"],
    ["quick_return", "Quick return"],
    ["item_bulk_import", "Items imported"],
  ])("formats %s as %s", (action, label) => {
    expect(formatActionLabel(action)).toBe(label);
  });

  it("humanizes action keys that do not have a specific label", () => {
    expect(formatActionLabel("offline_checkout_resolution_requested")).toBe(
      "Offline checkout resolution requested",
    );
  });

  it("handles empty action values", () => {
    expect(formatActionLabel("  ")).toBe("Unknown action");
  });
});
