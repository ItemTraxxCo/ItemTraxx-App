import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { submitContactSupportRequest } from "./contactSupportService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);

const basePayload = {
  name: "Jane Doe",
  reply_email: "jane@example.com",
  subject: "Can't check out an item",
  category: "bug" as const,
  message: "The scanner isn't working",
  turnstile_token: "tok",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("submitContactSupportRequest", () => {
  it("posts the payload to contact-support-submit and returns the accepted data", async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { ok: true, data: { accepted: true, request_id: "req-1" } },
    });

    const result = await submitContactSupportRequest(basePayload);

    expect(invokeEdgeFunction).toHaveBeenCalledWith("contact-support-submit", {
      method: "POST",
      body: basePayload,
    });
    expect(result).toEqual({ accepted: true, request_id: "req-1" });
  });

  it("throws a mapped edge-function error when the transport call fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 401, error: "", data: null });

    await expect(submitContactSupportRequest(basePayload)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("throws with the backend-provided error message when the inner payload reports failure", async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { ok: false, error: "Spam detected" },
    });

    await expect(submitContactSupportRequest(basePayload)).rejects.toThrow(/spam detected/i);
  });

  it("falls back to a default message when the request was not accepted and no error text given", async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { ok: true, data: { accepted: false } },
    });

    await expect(submitContactSupportRequest(basePayload)).rejects.toThrow(/unable to send support request/i);
  });
});
