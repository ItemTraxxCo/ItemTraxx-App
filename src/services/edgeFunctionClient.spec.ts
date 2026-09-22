import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./posthogDiagnostics", () => ({
  captureHandledRequestFailure: vi.fn(),
  capturePostHogLog: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { captureHandledRequestFailure } from "./posthogDiagnostics";

const jsonResponse = (body: unknown, headers: Record<string, string> = {}) => ({
  ok: true,
  status: 200,
  headers: { get: (name: string) => headers[name] ?? null },
  json: async () => body,
});

describe("invokeEdgeFunction CORS transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("VITE_EDGE_PROXY_URL", "https://edge.example.com");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses a CORS-simple JSON body by default for cookie-authenticated requests", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ data: { ok: true } }, { "x-request-id": "worker-request" }) as unknown as Response,
    );

    const result = await invokeEdgeFunction("super-workspace-mutate", {
      method: "POST",
      body: { action: "list_workspaces" },
    });

    expect(result).toMatchObject({ ok: true, requestId: "worker-request" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    const parsedUrl = new URL(url as string);
    expect(parsedUrl.pathname).toBe("/functions/super-workspace-mutate");
    expect(parsedUrl.searchParams.get("itx_request_id")).toMatch(/^[a-f0-9-]{36}$/i);
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("text/plain;charset=UTF-8");
    expect(headers["x-request-id"]).toBeUndefined();
    expect(init?.credentials).toBe("include");
    expect(JSON.parse(init?.body as string)).toEqual({ action: "list_workspaces" });
  });

  it("allows an endpoint to opt back into JSON and a client request id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ data: { ok: true } }) as unknown as Response,
    );

    await invokeEdgeFunction("offline-checkout", {
      method: "POST",
      body: { ok: true },
      avoidCorsPreflight: false,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["x-request-id"]).toEqual(expect.any(String));
    expect(new URL(vi.mocked(fetch).mock.calls[0]![0] as string).search).toBe("");
  });

  it("uses a CORS-simple GET for cookie-authenticated dashboard requests", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ data: { ok: true } }, { "x-request-id": "worker-request" }) as unknown as Response,
    );

    const result = await invokeEdgeFunction("super-dashboard", {
      method: "GET",
      avoidCorsPreflight: true,
    });

    expect(result).toMatchObject({ ok: true, requestId: "worker-request" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    const parsedUrl = new URL(url as string);
    expect(parsedUrl.pathname).toBe("/functions/super-dashboard");
    expect(parsedUrl.searchParams.get("itx_request_id")).toMatch(/^[a-f0-9-]{36}$/i);
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-request-id"]).toBeUndefined();
    expect(init?.credentials).toBe("include");
  });

  it("keeps the authenticated bearer transport and request id when a token is supplied", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: { ok: true } }) as unknown as Response);

    await invokeEdgeFunction("super-ops", {
      method: "POST",
      body: { ok: true },
      accessToken: "token",
      avoidCorsPreflight: true,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["x-request-id"]).toEqual(expect.any(String));
  });

  it("promotes a critical transport failure to PostHog error tracking", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const result = await invokeEdgeFunction("offline-checkout", {
      method: "POST",
      body: { action: "checkout" },
    });

    expect(result).toMatchObject({ ok: false, status: 0, error: "Network request failed." });
    expect(captureHandledRequestFailure).toHaveBeenCalledWith(expect.objectContaining({
      area: "edge_function",
      name: "offline-checkout",
      path: "/functions/offline-checkout",
      method: "POST",
      status: 0,
      errorCode: "network",
    }));
  });
});
