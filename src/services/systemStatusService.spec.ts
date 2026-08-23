import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./edgeUrls", () => ({
  getEdgeFunctionsBaseUrl: vi.fn(),
}));

import { getEdgeFunctionsBaseUrl } from "./edgeUrls";
import { fetchSystemStatus, probeSystemStatusTransport } from "./systemStatusService";

const mockedBaseUrl = vi.mocked(getEdgeFunctionsBaseUrl);

const jsonResponse = (body: unknown, init: { ok?: boolean; status?: number } = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  json: async () => body,
});

describe("fetchSystemStatus", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mockedBaseUrl.mockReturnValue("/functions");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns null immediately when there is no functions base URL configured", async () => {
    mockedBaseUrl.mockReturnValue("");

    const result = await fetchSystemStatus({ force: true });

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("issues a GET request to the status function and returns ok/status/payload", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ status: "operational" }) as unknown as Response
    );

    const result = await fetchSystemStatus({ force: true });

    expect(result).toEqual({ ok: true, status: 200, payload: { status: "operational" } });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/functions/system-status");
    expect((init as RequestInit).method).toBe("GET");
  });

  it("reports ok:false with the response status for a non-2xx response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ status: "down" }, { ok: false, status: 503 }) as unknown as Response
    );

    const result = await fetchSystemStatus({ force: true });

    expect(result).toEqual({ ok: false, status: 503, payload: { status: "down" } });
  });

  it("falls back to an empty payload when the response body is not valid JSON", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    const result = await fetchSystemStatus({ force: true });

    expect(result).toEqual({ ok: true, status: 200, payload: {} });
  });

  it("returns null when the fetch itself rejects (network failure)", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));

    const result = await fetchSystemStatus({ force: true });

    expect(result).toBeNull();
  });

  it("serves a cached result without calling fetch again within the TTL window", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ status: "operational" }) as unknown as Response
    );
    await fetchSystemStatus({ force: true });
    vi.mocked(fetch).mockClear();

    const cached = await fetchSystemStatus();

    expect(cached).toEqual({ ok: true, status: 200, payload: { status: "operational" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("force:true always re-fetches even when a fresh cache entry exists", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ status: "operational" }) as unknown as Response
    );
    await fetchSystemStatus({ force: true });
    vi.mocked(fetch).mockClear();

    await fetchSystemStatus({ force: true });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent in-flight requests into a single fetch call", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    vi.mocked(fetch).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }) as unknown as Promise<Response>
    );

    const first = fetchSystemStatus({ force: true });
    const second = fetchSystemStatus({ force: true });
    resolveFetch(jsonResponse({ status: "operational" }));
    await Promise.all([first, second]);

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("probeSystemStatusTransport", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mockedBaseUrl.mockReturnValue("/functions");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("recognizes an opaque/no-cors response as reachable", async () => {
    vi.mocked(fetch).mockResolvedValue({ type: "opaque" } as Response);

    await expect(probeSystemStatusTransport()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "/functions/system-status",
      expect.objectContaining({ method: "GET", mode: "no-cors", cache: "no-store" }),
    );
  });

  it("returns false when the transport request fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));

    await expect(probeSystemStatusTransport()).resolves.toBe(false);
  });
});
