import { describe, expect, it, vi } from "vitest";

vi.mock("../edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));

import { invokeEdgeFunction } from "../edgeFunctionClient";
import { AppError } from "../appErrors";
import { callSuperOps } from "./client";

const mockedInvoke = vi.mocked(invokeEdgeFunction);

describe("callSuperOps", () => {
  it("invokes the super-ops edge function with a POST method and the given action/payload", async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: { data: { hello: "world" } },
    });

    const result = await callSuperOps<{ hello: string }>({
      action: "get_control_center",
      payload: { foo: "bar" },
    });

    expect(result).toEqual({ hello: "world" });
    expect(mockedInvoke).toHaveBeenCalledWith("super-ops", {
      method: "POST",
      body: { action: "get_control_center", payload: { foo: "bar" } },
    });
  });

  it("returns undefined when the response has no nested data field", async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: true,
      status: 200,
      error: "",
      data: undefined,
    });

    const result = await callSuperOps({ action: "get_control_center", payload: {} });
    expect(result).toBeUndefined();
  });

  it("throws an AppError built from edgeFunctionError when the request fails", async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: false,
      status: 422,
      error: "Invalid barcode format",
      data: null,
    });

    await expect(
      callSuperOps({ action: "get_control_center", payload: {} })
    ).rejects.toBeInstanceOf(AppError);
  });

  it("maps a 401 failure to an UNAUTHORIZED AppError", async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: "Unauthorized",
      data: null,
    });

    try {
      await callSuperOps({ action: "get_control_center", payload: {} });
      throw new Error("expected callSuperOps to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("UNAUTHORIZED");
    }
  });

  it("falls back to the default failure message when the server provides no error text", async () => {
    mockedInvoke.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: "",
      data: null,
    });

    await expect(
      callSuperOps({ action: "get_control_center", payload: {} })
    ).rejects.toThrow("Super ops request failed. Please try again.");
  });
});
