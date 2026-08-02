import { describe, expect, it, vi } from "vitest";
import {
  AppError,
  edgeFunctionError,
  isUnauthorizedError,
  missingContextError,
  shouldReportError,
  toUserFacingErrorMessage,
  unauthorizedError,
} from "./appErrors";

describe("unauthorizedError", () => {
  it("dispatches a recoverable-app-error event and returns a non-reporting AppError", async () => {
    const listener = vi.fn();
    window.addEventListener("itemtraxx:recoverable-app-error", listener as EventListener);

    const error = unauthorizedError();

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.status).toBe(401);
    expect(error.reportToSentry).toBe(false);

    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("itemtraxx:recoverable-app-error", listener as EventListener);
  });
});

describe("missingContextError", () => {
  it("builds a 400 non-reporting AppError", () => {
    const error = missingContextError("Missing tenant context");
    expect(error.code).toBe("MISSING_CONTEXT");
    expect(error.status).toBe(400);
    expect(error.reportToSentry).toBe(false);
    expect(error.message).toBe("Missing tenant context");
  });
});

describe("edgeFunctionError", () => {
  it("maps a 401 status to UNAUTHORIZED regardless of message", () => {
    const error = edgeFunctionError({ status: 401, error: "" }, "fallback");
    expect(error.code).toBe("UNAUTHORIZED");
  });

  it("maps an unauthorized message body to UNAUTHORIZED even with a 200-range status", () => {
    const error = edgeFunctionError({ status: 200, error: "Unauthorized" }, "fallback");
    expect(error.code).toBe("UNAUTHORIZED");
  });

  it("maps a 429 status or rate-limit message to RATE_LIMIT", () => {
    expect(edgeFunctionError({ status: 429, error: "" }, "fallback").code).toBe("RATE_LIMIT");
    expect(edgeFunctionError({ status: 400, error: "Too many requests" }, "fallback").code).toBe("RATE_LIMIT");
  });

  it("maps a timed-out message to TIMEOUT", () => {
    const error = edgeFunctionError({ status: 0, error: "Request timed out" }, "fallback");
    expect(error.code).toBe("TIMEOUT");
    expect(error.reportToSentry).toBe(false);
  });

  it("maps a network-failure message to NETWORK", () => {
    const error = edgeFunctionError({ status: 0, error: "Network request failed" }, "fallback");
    expect(error.code).toBe("NETWORK");
    expect(error.reportToSentry).toBe(false);
  });

  it("maps a workspace/tenant disabled message to TENANT_DISABLED with a 403 default status", () => {
    const error = edgeFunctionError({ status: 0, error: "Workspace disabled" }, "fallback");
    expect(error.code).toBe("TENANT_DISABLED");
    expect(error.status).toBe(403);
  });

  it("preserves a non-zero status for TENANT_DISABLED when provided", () => {
    const error = edgeFunctionError({ status: 451, error: "tenant disabled for policy reasons" }, "fallback");
    expect(error.status).toBe(451);
  });

  it("falls back to REQUEST_FAILED and reports to Sentry only for 5xx", () => {
    const clientError = edgeFunctionError({ status: 422, error: "Invalid barcode format" }, "fallback");
    expect(clientError.code).toBe("REQUEST_FAILED");
    expect(clientError.reportToSentry).toBe(false);

    const serverError = edgeFunctionError({ status: 502, error: "upstream exploded" }, "fallback");
    expect(serverError.code).toBe("REQUEST_FAILED");
    expect(serverError.reportToSentry).toBe(true);
  });

  it("uses the fallback message when the result has no error text", () => {
    const error = edgeFunctionError({ status: 500, error: "" }, "Something went wrong");
    expect(error.message).toBe("Something went wrong");
  });

  it("uses the fallback message when the error text is only whitespace", () => {
    const error = edgeFunctionError({ status: 500, error: "   " }, "Something went wrong");
    expect(error.message).toBe("Something went wrong");
  });
});

describe("isUnauthorizedError", () => {
  it("recognizes an AppError with UNAUTHORIZED code", () => {
    expect(isUnauthorizedError(new AppError("UNAUTHORIZED", "expired"))).toBe(true);
  });

  it("does not treat other AppError codes as unauthorized", () => {
    expect(isUnauthorizedError(new AppError("NETWORK", "offline"))).toBe(false);
  });

  it("recognizes plain Error objects with an 'unauthorized' message", () => {
    expect(isUnauthorizedError(new Error("Unauthorized"))).toBe(true);
    expect(isUnauthorizedError(new Error("unauthorized."))).toBe(true);
  });

  it("returns false for unrelated values", () => {
    expect(isUnauthorizedError(new Error("boom"))).toBe(false);
    expect(isUnauthorizedError("unauthorized")).toBe(false);
    expect(isUnauthorizedError(null)).toBe(false);
  });
});

describe("shouldReportError", () => {
  it("respects AppError.reportToSentry", () => {
    expect(shouldReportError(new AppError("NETWORK", "x", { reportToSentry: false }))).toBe(false);
    expect(shouldReportError(new AppError("REQUEST_FAILED", "x", { reportToSentry: true }))).toBe(true);
  });

  it("defaults to reporting for non-AppError errors", () => {
    expect(shouldReportError(new Error("boom"))).toBe(true);
  });
});

describe("toUserFacingErrorMessage", () => {
  const fallback = "Something went wrong. Please try again.";

  it("returns the fallback for an error with no message", () => {
    expect(toUserFacingErrorMessage(new Error(""), fallback)).toBe(fallback);
  });

  it("maps each AppError code to its user-facing copy", () => {
    expect(toUserFacingErrorMessage(new AppError("UNAUTHORIZED", "x"), fallback)).toMatch(/session has expired/i);
    expect(toUserFacingErrorMessage(new AppError("RATE_LIMIT", "x"), fallback)).toMatch(/too many requests/i);
    expect(toUserFacingErrorMessage(new AppError("NETWORK", "x"), fallback)).toMatch(/network issue/i);
    expect(toUserFacingErrorMessage(new AppError("TIMEOUT", "x"), fallback)).toMatch(/timed out/i);
    expect(toUserFacingErrorMessage(new AppError("TENANT_DISABLED", "x"), fallback)).toMatch(/cannot be used/i);
  });

  it("pattern-matches REQUEST_FAILED messages to specific copy", () => {
    expect(toUserFacingErrorMessage(new AppError("REQUEST_FAILED", "Invalid barcode supplied"), fallback))
      .toMatch(/invalid barcode/i);
    expect(toUserFacingErrorMessage(new AppError("REQUEST_FAILED", "Borrower not found in roster"), fallback))
      .toMatch(/borrower not found/i);
    expect(toUserFacingErrorMessage(new AppError("REQUEST_FAILED", "missing tenant context"), fallback))
      .toMatch(/missing required account information/i);
  });

  it("falls back for an unrecognized REQUEST_FAILED message", () => {
    expect(toUserFacingErrorMessage(new AppError("REQUEST_FAILED", "some obscure db error"), fallback)).toBe(fallback);
  });

  it("pattern-matches plain Error messages the same way as AppError codes", () => {
    expect(toUserFacingErrorMessage(new Error("Unauthorized"), fallback)).toMatch(/session has  expired/i);
    expect(toUserFacingErrorMessage(new Error("Network request failed"), fallback)).toMatch(/network issue/i);
    expect(toUserFacingErrorMessage(new Error("Request timed out"), fallback)).toMatch(/timed out/i);
    expect(toUserFacingErrorMessage(new Error("Too many requests"), fallback)).toMatch(/too many requests/i);
    expect(toUserFacingErrorMessage(new Error("Workspace disabled"), fallback)).toMatch(/cannot be used/i);
    expect(toUserFacingErrorMessage(new Error("Invalid barcode"), fallback)).toMatch(/invalid barcode/i);
    expect(toUserFacingErrorMessage(new Error("Borrower not found"), fallback)).toMatch(/borrower not found/i);
    expect(toUserFacingErrorMessage(new Error("Session expired"), fallback)).toMatch(/expired or has been terminated/i);
    expect(toUserFacingErrorMessage(new Error("Missing tenant context"), fallback)).toMatch(/missing required account information/i);
  });

  it("falls back for opaque DB/schema-shaped errors", () => {
    expect(toUserFacingErrorMessage(new Error("PGRST116 schema cache error"), fallback)).toBe(fallback);
    expect(toUserFacingErrorMessage(new Error("unable to reach the database"), fallback)).toBe(fallback);
    expect(toUserFacingErrorMessage(new Error("failed to update column"), fallback)).toBe(fallback);
  });

  it("falls back for a completely unrecognized message", () => {
    expect(toUserFacingErrorMessage(new Error("something truly novel happened"), fallback)).toBe(fallback);
  });
});
