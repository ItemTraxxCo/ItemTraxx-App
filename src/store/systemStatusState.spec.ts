import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/systemStatusService", () => ({
  fetchSystemStatus: vi.fn(),
}));

import { fetchSystemStatus } from "../services/systemStatusService";
import { systemStatusState } from "./systemStatusState";

const mockedFetch = vi.mocked(fetchSystemStatus);

afterEach(() => {
  systemStatusState.release();
  systemStatusState.release(); // safe even if consumers is already 0
  mockedFetch.mockReset();
  vi.useRealTimers();
});

describe("statusLabel / statusClass", () => {
  it("shows Loading before any result has ever come back", () => {
    expect(systemStatusState.statusLabel.value).toBe("Loading...");
    expect(systemStatusState.statusClass.value).toBe("status-unknown");
  });

  it("shows Running/status-ok for an operational payload", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      payload: { status: "operational" } as never,
    });
    await systemStatusState.refresh();
    expect(systemStatusState.statusLabel.value).toBe("Running");
    expect(systemStatusState.statusClass.value).toBe("status-ok");
  });

  it("shows Down/status-down for a 5xx response or a down payload", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 503, payload: { status: "down" } as never });
    await systemStatusState.refresh();
    expect(systemStatusState.statusLabel.value).toBe("Down");
    expect(systemStatusState.statusClass.value).toBe("status-down");
  });

  it("shows Degraded/status-warn for anything else", async () => {
    mockedFetch.mockResolvedValue({ ok: true, status: 200, payload: { status: "degraded" } as never });
    await systemStatusState.refresh();
    expect(systemStatusState.statusLabel.value).toBe("Degraded");
    expect(systemStatusState.statusClass.value).toBe("status-warn");
  });
});

describe("refresh", () => {
  it("resets hasResult/responseOk when fetchSystemStatus returns no payload", async () => {
    mockedFetch.mockResolvedValue({ ok: true, status: 200, payload: { status: "operational" } as never });
    await systemStatusState.refresh();
    expect(systemStatusState.state.hasResult).toBe(true);

    mockedFetch.mockResolvedValue(null as never);
    await systemStatusState.refresh();
    expect(systemStatusState.state.hasResult).toBe(false);
    expect(systemStatusState.state.responseOk).toBe(false);
  });

  it("is re-entrant safe: a concurrent refresh call while loading is a no-op", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    mockedFetch.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }) as never);

    const first = systemStatusState.refresh();
    const second = systemStatusState.refresh();
    resolveFetch({ ok: true, status: 200, payload: { status: "operational" } });
    await Promise.all([first, second]);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});

describe("acquire / release lifecycle", () => {
  it("triggers an initial refresh on first acquire", async () => {
    mockedFetch.mockResolvedValue({ ok: true, status: 200, payload: { status: "operational" } as never });
    systemStatusState.acquire();
    await vi.waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    systemStatusState.release();
  });

  it("does not trigger a second refresh for a second concurrent consumer", async () => {
    mockedFetch.mockResolvedValue({ ok: true, status: 200, payload: { status: "operational" } as never });
    systemStatusState.acquire();
    await vi.waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    systemStatusState.acquire();
    await Promise.resolve();
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    systemStatusState.release();
    systemStatusState.release();
  });

  it("never lets the consumer count go negative on extra releases", () => {
    expect(() => systemStatusState.release()).not.toThrow();
    expect(() => systemStatusState.release()).not.toThrow();
  });
});
