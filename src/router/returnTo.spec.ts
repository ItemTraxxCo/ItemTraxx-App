import { describe, expect, it } from "vitest";
import { addLoginContext, sanitizeReturnTo } from "./returnTo";

describe("login return targets", () => {
  it.each([
    ["/checkout", "/checkout"],
    ["/checkout?borrower=123#items", "/checkout?borrower=123#items"],
    [" /admin/items ", "/admin/items"],
  ])("keeps a safe internal target %s", (candidate, expected) => {
    expect(sanitizeReturnTo(candidate)).toBe(expected);
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/login",
    "/login/two-factor",
    "checkout",
    "",
    null,
    42,
  ])("rejects an unsafe target %s", (candidate) => {
    expect(sanitizeReturnTo(candidate)).toBeNull();
  });

  it("adds only the allowlisted login context", () => {
    expect(addLoginContext("/checkout?source=email", "regular_login")).toBe(
      "/checkout?source=email&login_ctx=regular_login",
    );
  });
});
