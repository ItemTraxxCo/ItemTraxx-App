import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { submitContactSalesLead } from "./contactSalesService";

const mockedInvoke = vi.mocked(invokeEdgeFunction);

const basePayload = {
  plan: "workspace_growth" as const,
  name: "Jane Doe",
  organization: "Acme School",
  reply_email: "jane@example.com",
  details: "We need 500 seats",
  turnstile_token: "tok",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("submitContactSalesLead", () => {
  it("posts the payload to contact-sales-submit and returns the lead data", async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { ok: true, data: { lead_id: "lead-1" } },
    });

    const result = await submitContactSalesLead(basePayload);

    expect(invokeEdgeFunction).toHaveBeenCalledWith("contact-sales-submit", {
      method: "POST",
      body: basePayload,
    });
    expect(result).toEqual({ lead_id: "lead-1" });
  });

  it("throws a mapped edge-function error when the transport call fails", async () => {
    mockedInvoke.mockResolvedValue({ ok: false, status: 429, error: "Too many requests", data: null });

    await expect(submitContactSalesLead(basePayload)).rejects.toMatchObject({ code: "RATE_LIMIT" });
  });

  it("throws with the backend-provided error message when ok but the inner payload reports failure", async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { ok: false, error: "Turnstile verification failed" },
    });

    await expect(submitContactSalesLead(basePayload)).rejects.toThrow(/turnstile verification failed/i);
  });

  it("falls back to a default message when no lead_id is present and no error text given", async () => {
    mockedInvoke.mockResolvedValue({
      ok: true,
      status: 200,
      error: "",
      data: { ok: true, data: undefined as unknown as { lead_id: string } },
    });

    await expect(submitContactSalesLead(basePayload)).rejects.toThrow(/unable to send sales request/i);
  });
});
