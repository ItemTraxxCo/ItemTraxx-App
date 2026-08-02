import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  callSuperOps: vi.fn(),
}));

import { callSuperOps } from "./client";
import { getSupportRequest, listSupportRequests, updateSupportRequest } from "./support";
import type { SupportRequestDetail, SupportRequestListItem } from "./types";

const mockedCall = vi.mocked(callSuperOps);

const listItem: SupportRequestListItem = {
  id: "req-1",
  requester_name: "Jane Doe",
  reply_email: "jane@acme.test",
  subject: "Cannot log in",
  category: "access",
  status: "open",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  assigned_to: null,
};

describe("listSupportRequests", () => {
  it("defaults to an empty payload and returns the requests", async () => {
    mockedCall.mockResolvedValueOnce({ requests: [listItem] });

    const result = await listSupportRequests();

    expect(result).toEqual({ requests: [listItem] });
    expect(mockedCall).toHaveBeenCalledWith({ action: "list_support_requests", payload: {} });
  });

  it("forwards a provided search/status/limit payload", async () => {
    mockedCall.mockResolvedValueOnce({ requests: [] });

    await listSupportRequests({ search: "login", status: "open", limit: 20 });

    expect(mockedCall).toHaveBeenCalledWith({
      action: "list_support_requests",
      payload: { search: "login", status: "open", limit: 20 },
    });
  });
});

describe("getSupportRequest", () => {
  it("forwards the support_request_id and returns the detail", async () => {
    const detail: SupportRequestDetail = {
      ...listItem,
      message: "I can't log in.",
      source: "contact_form",
      internal_notes: null,
      assigned_to_email: null,
      attachments: [],
      events: [],
    };
    mockedCall.mockResolvedValueOnce({ request: detail });

    const result = await getSupportRequest({ support_request_id: "req-1" });

    expect(result).toEqual({ request: detail });
    expect(mockedCall).toHaveBeenCalledWith({
      action: "get_support_request",
      payload: { support_request_id: "req-1" },
    });
  });

  it("propagates a rejection from callSuperOps", async () => {
    mockedCall.mockRejectedValueOnce(new Error("not found"));
    await expect(getSupportRequest({ support_request_id: "missing" })).rejects.toThrow("not found");
  });
});

describe("updateSupportRequest", () => {
  it("forwards only the provided fields alongside the required id", async () => {
    mockedCall.mockResolvedValueOnce({ request: { ...listItem, status: "resolved" } });

    const result = await updateSupportRequest({
      support_request_id: "req-1",
      status: "resolved",
    });

    expect(result).toEqual({ request: { ...listItem, status: "resolved" } });
    expect(mockedCall).toHaveBeenCalledWith({
      action: "update_support_request",
      payload: { support_request_id: "req-1", status: "resolved" },
    });
  });

  it("forwards assignment fields when set", async () => {
    mockedCall.mockResolvedValueOnce({ request: listItem });

    await updateSupportRequest({
      support_request_id: "req-1",
      assign_to_me: true,
      clear_assignment: false,
      internal_notes: "Looking into it",
    });

    expect(mockedCall).toHaveBeenCalledWith({
      action: "update_support_request",
      payload: {
        support_request_id: "req-1",
        assign_to_me: true,
        clear_assignment: false,
        internal_notes: "Looking into it",
      },
    });
  });
});
