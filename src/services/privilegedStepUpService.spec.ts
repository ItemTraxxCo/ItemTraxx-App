import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));

import { registerPrivilegedAdminStepUp } from "./privilegedStepUpService";
import { invokeEdgeFunction } from "./edgeFunctionClient";

describe("registerPrivilegedAdminStepUp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the privileged-step-up function with the access token and returns the registration data", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { data: { registered: true, expires_at: "2026-08-01T00:00:00Z" } },
    });

    const result = await registerPrivilegedAdminStepUp("token-123");

    expect(invokeEdgeFunction).toHaveBeenCalledWith("privileged-step-up", {
      method: "POST",
      body: {},
      accessToken: "token-123",
    });
    expect(result).toEqual({ registered: true, expires_at: "2026-08-01T00:00:00Z" });
  });

  it("works without an access token override", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { data: { registered: true, expires_at: "2026-08-01T00:00:00Z" } },
    });

    await registerPrivilegedAdminStepUp();

    expect(invokeEdgeFunction).toHaveBeenCalledWith("privileged-step-up", {
      method: "POST",
      body: {},
      accessToken: undefined,
    });
  });

  it("defaults to an unregistered result when the response has no data payload", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: null,
    });

    const result = await registerPrivilegedAdminStepUp("token-123");

    expect(result).toEqual({ registered: false, expires_at: "" });
  });

  it("throws a mapped error when the request fails", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: "upstream exploded",
      data: null,
    });

    await expect(registerPrivilegedAdminStepUp("token-123")).rejects.toThrow("upstream exploded");
  });

  it("falls back to the default message when the failed response has no error text", async () => {
    vi.mocked(invokeEdgeFunction).mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: "",
      data: null,
    });

    await expect(registerPrivilegedAdminStepUp()).rejects.toThrow(
      "Unable to verify admin session. Please sign out and try again."
    );
  });
});
