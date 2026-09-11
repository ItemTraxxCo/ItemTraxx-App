import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sentry", () => ({
  captureHandledRequestFailure: vi.fn(),
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";

const jsonResponse = (body: unknown, headers: Record<string, string> = {}) => ({
  ok: true,
  status: 200,
  headers: { get: (name: string) => headers[name] ?? null },
  json: async () => body,
});

describe("invokeEdgeFunction CORS transport", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("VITE_EDGE_PROXY_URL", "https://edge.example.com");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses a CORS-simple JSON body for cookie-authenticated requests", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ data: { ok: true } }, { "x-request-id": "worker-request" }) as unknown as Response,
    );

    const result = await invokeEdgeFunction("super-workspace-mutate", {
      method: "POST",
      body: { action: "list_workspaces" },
      avoidCorsPreflight: true,
    });

    expect(result).toMatchObject({ ok: true, requestId: "worker-request" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://edge.example.com/functions/super-workspace-mutate");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("text/plain;charset=UTF-8");
    expect(headers["x-request-id"]).toBeUndefined();
    expect(init?.credentials).toBe("include");
    expect(JSON.parse(init?.body as string)).toEqual({ action: "list_workspaces" });
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
});
