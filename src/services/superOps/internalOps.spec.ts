import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  callSuperOps: vi.fn(),
}));

import { callSuperOps } from "./client";
import { getInternalOpsSnapshot } from "./internalOps";
import type { InternalOpsSnapshot } from "./types";

const mockedCall = vi.mocked(callSuperOps);

describe("getInternalOpsSnapshot", () => {
  it("requests get_internal_ops_snapshot with an empty payload and returns the result", async () => {
    const snapshot = {
      checked_at: "2026-01-01T00:00:00Z",
      traffic: { checkout_15m: 1, return_15m: 2, active_workspaces_15m: 3, events_24h: 4 },
      queue: { queued: 0, processing: 0, completed: 0, failed: 0 },
      leads: {
        open: 0,
        closed: 0,
        converted: 0,
        waiting_for_quote: 0,
        quote_sent: 0,
        invoice_sent: 0,
        invoice_paid: 0,
      },
      lead_funnel: {
        waiting_for_quote: 0,
        quote_generated: 0,
        quote_sent: 0,
        quote_converted_to_invoice: 0,
        invoice_sent: 0,
        invoice_paid: 0,
      },
      traffic_by_hour: [],
      sla: { median_latency_ms: null, p95_latency_ms: null, error_rate_percent: 0, probe_latency_ms: null },
      needs_attention: [],
      customer_health: {
        total_customers: 0,
        awaiting_payment: 0,
        canceling: 0,
        paid_late: 0,
        paid_on_time: 0,
        no_status: 0,
      },
      recent_audit: [],
      search_index: [],
      runtime: {},
      recent_events: [],
    } satisfies InternalOpsSnapshot;
    mockedCall.mockResolvedValueOnce(snapshot);

    const result = await getInternalOpsSnapshot();

    expect(result).toBe(snapshot);
    expect(mockedCall).toHaveBeenCalledWith({ action: "get_internal_ops_snapshot", payload: {} });
  });

  it("propagates a rejection from callSuperOps", async () => {
    mockedCall.mockRejectedValueOnce(new Error("snapshot failed"));
    await expect(getInternalOpsSnapshot()).rejects.toThrow("snapshot failed");
  });
});
