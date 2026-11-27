import { afterEach, describe, expect, it, vi } from "vitest";

const { mockCallSuperOps } = vi.hoisted(() => ({
  mockCallSuperOps: vi.fn(),
}));

vi.mock("./client", () => ({
  callSuperOps: mockCallSuperOps,
}));

import {
  clearActiveJitSession,
  getActiveJitTokenForWorkspace,
} from "../../store/jitAccessState";
import {
  invokeBreakGlassAccess,
  requestJitSupportTicket,
  revokeJitSupportTicket,
} from "./jitAccess";

describe("superOps JIT access service", () => {
  afterEach(() => {
    clearActiveJitSession();
    mockCallSuperOps.mockReset();
    vi.useRealTimers();
  });

  it("stores read_only JIT ticket in memory, blocks break_glass scope, and expires at T+1s", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-11-26T12:00:00.000Z");
    vi.setSystemTime(now);
    const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();

    mockCallSuperOps.mockResolvedValue({
      ticket: {
        id: "30000000-0000-4000-8000-000000000001",
        admin_user_id: "10000000-0000-4000-8000-000000000001",
        workspace_id: "20000000-0000-4000-8000-000000000001",
        scope: "read_only",
        status: "active",
        reason: "Support ticket investigation",
        external_ticket_id: "SUP-102",
        ttl_minutes: 15,
        issued_at: now.toISOString(),
        expires_at: expiresAt,
      },
      token: "signed.read.only",
    });

    await requestJitSupportTicket({
      workspace_id: "20000000-0000-4000-8000-000000000001",
      reason: "Support ticket investigation",
      external_ticket_id: "SUP-102",
      ttl_minutes: 15,
    });

    expect(
      getActiveJitTokenForWorkspace("20000000-0000-4000-8000-000000000001", "read_only"),
    ).toBe("signed.read.only");
    expect(
      getActiveJitTokenForWorkspace("20000000-0000-4000-8000-000000000001", "break_glass"),
    ).toBeNull();
    expect(
      getActiveJitTokenForWorkspace("20000000-0000-4000-8000-000000000002", "read_only"),
    ).toBeNull();

    vi.advanceTimersByTime(15 * 60_000 + 1000);
    expect(
      getActiveJitTokenForWorkspace("20000000-0000-4000-8000-000000000001", "read_only"),
    ).toBeNull();
  });

  it("supports break-glass without incident_id and clears memory immediately on revoke", async () => {
    const now = Date.now();
    mockCallSuperOps.mockResolvedValueOnce({
      ticket: {
        id: "30000000-0000-4000-8000-000000000002",
        admin_user_id: "10000000-0000-4000-8000-000000000001",
        workspace_id: "20000000-0000-4000-8000-000000000001",
        scope: "break_glass",
        status: "active",
        reason: "Emergency borrower recovery",
        external_ticket_id: null,
        ttl_minutes: 15,
        issued_at: new Date(now).toISOString(),
        expires_at: new Date(now + 15 * 60_000).toISOString(),
      },
      break_glass_event_id: "40000000-0000-4000-8000-000000000001",
      alert_delivery: {
        status: "delivered",
        attempted_channels: ["incident_io", "resend_email"],
        delivered_channels: ["incident_io", "resend_email"],
        queued_retries: 0,
      },
      token: "signed.break.glass",
    });

    await invokeBreakGlassAccess({
      workspace_id: "20000000-0000-4000-8000-000000000001",
      justification: "Emergency borrower recovery requested by admin",
      acknowledged_by: "Dennis Frenkel",
    });

    expect(
      getActiveJitTokenForWorkspace("20000000-0000-4000-8000-000000000001", "break_glass"),
    ).toBe("signed.break.glass");

    mockCallSuperOps.mockResolvedValueOnce({
      ticket: {
        id: "30000000-0000-4000-8000-000000000002",
        workspace_id: "20000000-0000-4000-8000-000000000001",
        scope: "break_glass",
        status: "revoked",
        revoked_at: new Date().toISOString(),
      },
    });
    await revokeJitSupportTicket("30000000-0000-4000-8000-000000000002", "Done");
    expect(
      getActiveJitTokenForWorkspace("20000000-0000-4000-8000-000000000001", "read_only"),
    ).toBeNull();
  });
});
