import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeFunctionClient", () => ({
  invokeEdgeFunction: vi.fn(),
}));
vi.mock("./clientDiagnostics", () => ({
  getClientDiagnosticsSnapshot: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { getClientDiagnosticsSnapshot } from "./clientDiagnostics";
import { sendClientErrorReport } from "./clientErrorReportService";
import { clearAuthState, setAuthStateFromBackend } from "../store/authState";
import { clearWorkspaceState, setWorkspaceState } from "../store/workspaceState";

const mockedInvoke = vi.mocked(invokeEdgeFunction);
const mockedSnapshot = vi.mocked(getClientDiagnosticsSnapshot);

afterEach(() => {
  clearAuthState();
  clearWorkspaceState();
  vi.clearAllMocks();
});

describe("sendClientErrorReport", () => {
  it("sends a truncated, well-shaped payload including auth/workspace/diagnostics context", async () => {
    setAuthStateFromBackend({ isAuthenticated: true, userId: "user-1", role: "workspace_admin" });
    setWorkspaceState({ isWorkspaceHost: true, workspaceId: "workspace-1" });
    mockedSnapshot.mockReturnValue({ console: [], network: [] });
    mockedInvoke.mockResolvedValue({ ok: true, status: 200, error: "", data: { accepted: true } });

    await sendClientErrorReport({
      title: "Fatal error",
      message: "a".repeat(3000),
      reason: "network failure",
      error_name: "TypeError",
      stack: "at foo()",
      context: "checkout",
    });

    expect(invokeEdgeFunction).toHaveBeenCalledTimes(1);
    const [name, options] = mockedInvoke.mock.calls[0]!;
    expect(name).toBe("client-error-report");
    const body = (options as { body: Record<string, unknown> }).body;
    expect((body.message as string).length).toBe(1200);
    expect(body.title).toBe("Fatal error");
    expect(body.auth).toEqual({ is_authenticated: true, role: "workspace_admin", workspace_id: null });
    expect(body.workspace).toEqual({ is_workspace_host: true, workspace_id: "workspace-1" });
    expect(body.diagnostics).toEqual({ console: [], network: [] });
    expect((body.page as { url: string }).url).toContain(window.location.pathname);
  });

  it("keeps report text within the edge function validation limits", async () => {
    mockedSnapshot.mockReturnValue({ console: [], network: [] });
    mockedInvoke.mockResolvedValue({ ok: true, status: 200, error: "", data: { accepted: true } });

    await sendClientErrorReport({
      title: "Fatal error",
      message: "m".repeat(2000),
      reason: "controlled test",
      stack: `first line\n${"s".repeat(6000)}`,
      context: "c".repeat(400),
    });

    const [, options] = mockedInvoke.mock.calls[0]!;
    const body = (options as { body: Record<string, unknown> }).body;
    expect((body.message as string).length).toBe(1200);
    expect((body.stack as string).length).toBe(5000);
    expect(body.stack).toContain("\n");
    expect((body.context as string).length).toBe(300);
  });

  it("normalizes report controls and compacts oversized diagnostics", async () => {
    mockedSnapshot.mockReturnValue({
      console: Array.from({ length: 80 }, (_, index) => ({
        level: "error",
        message: `console-${index}\u0000${"x".repeat(600)}`,
        timestamp: "2026-09-21T15:13:24.000Z",
      })),
      network: Array.from({ length: 40 }, (_, index) => ({
        method: "POST",
        url: `https://example.test/network/${index}`,
        status: 500,
        ok: false,
        duration_ms: 20,
        request_id: null,
        timestamp: "2026-09-21T15:13:24.000Z",
        error: "x".repeat(600),
      })),
    });
    mockedInvoke.mockResolvedValue({ ok: true, status: 200, error: "", data: { accepted: true } });

    await sendClientErrorReport({
      title: "  Fatal\u0000 error\n",
      message: "first\u0000\nsecond",
      reason: "controlled\t test",
      stack: "line 1\r\nline 2\u0007",
      context: "checkout\nflow",
    });

    const [, options] = mockedInvoke.mock.calls[0]!;
    const body = (options as { body: Record<string, unknown> }).body;
    expect(body.title).toBe("Fatal error");
    expect(body.message).toBe("first \nsecond");
    expect(body.reason).toBe("controlled test");
    expect(body.stack).toBe("line 1\nline 2");
    expect(body.context).toBe("checkout flow");

    const diagnostics = body.diagnostics as Record<string, unknown>;
    expect(new TextEncoder().encode(JSON.stringify(diagnostics)).byteLength).toBeLessThanOrEqual(20_000);
    expect(diagnostics.diagnostics_truncated).toBe(true);
    expect((diagnostics.console as Array<Record<string, unknown>>).at(-1)?.message)
      .toContain("console-79");
  });

  it("trims optional fields and defaults them to empty strings when omitted", async () => {
    mockedSnapshot.mockReturnValue({ console: [], network: [] });
    mockedInvoke.mockResolvedValue({ ok: true, status: 200, error: "", data: { accepted: true } });

    await sendClientErrorReport({ title: "  Oops  ", message: "boom", reason: "unknown" });

    const [, options] = mockedInvoke.mock.calls[0]!;
    const body = (options as { body: Record<string, unknown> }).body;
    expect(body.title).toBe("Oops");
    expect(body.error_name).toBe("");
    expect(body.stack).toBe("");
    expect(body.context).toBe("");
  });

  it("throws when the edge function reports failure", async () => {
    mockedSnapshot.mockReturnValue({ console: [], network: [] });
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "upstream error", data: null });

    await expect(
      sendClientErrorReport({ title: "t", message: "m", reason: "r" })
    ).rejects.toThrow("upstream error");
  });

  it("falls back to a support-contact message when the error result has no error text", async () => {
    mockedSnapshot.mockReturnValue({ console: [], network: [] });
    mockedInvoke.mockResolvedValue({ ok: false, status: 500, error: "", data: null });

    await expect(
      sendClientErrorReport({ title: "t", message: "m", reason: "r" })
    ).rejects.toThrow(/contact support directly/i);
  });
});
