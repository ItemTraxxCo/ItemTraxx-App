import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../store/authState", () => ({
  clearAdminVerification: vi.fn(),
  clearAuthState: vi.fn(),
}));

vi.mock("./edgeUrls", () => ({
  getEdgeFunctionsBaseUrl: vi.fn(),
}));

vi.mock("./sentry", () => ({
  captureHandledRequestFailure: vi.fn(),
}));

vi.mock("./supabaseAuthSession", () => ({
  signOutLocalSupabaseSession: vi.fn(),
}));

vi.mock("./supabaseClient", () => ({
  supabase: {
    auth: {
      refreshSession: vi.fn(),
    },
  },
}));

import { invokeEdgeFunction } from "./edgeFunctionClient";
import { clearAdminVerification, clearAuthState } from "../store/authState";
import { getEdgeFunctionsBaseUrl } from "./edgeUrls";
import { captureHandledRequestFailure } from "./sentry";
import { signOutLocalSupabaseSession } from "./supabaseAuthSession";
import { supabase } from "./supabaseClient";

const BASE_URL = "https://proxy.example.com/functions";

type FakeResponseInit = {
  ok: boolean;
  status: number;
  json?: unknown;
  jsonThrows?: boolean;
  headers?: Record<string, string>;
};

const makeResponse = ({ ok, status, json = null, jsonThrows = false, headers = {} }: FakeResponseInit) => ({
  ok,
  status,
  headers: {
    get: (name: string) => headers[name] ?? null,
  },
  json: async () => {
    if (jsonThrows) throw new Error("invalid json");
    return json;
  },
});

describe("edgeFunctionClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEdgeFunctionsBaseUrl).mockReturnValue(BASE_URL);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a config error without calling fetch when the base URL is missing", async () => {
    vi.mocked(getEdgeFunctionsBaseUrl).mockReturnValue("");
    const result = await invokeEdgeFunction("checkoutReturn");
    expect(result).toEqual({
      ok: false,
      status: 500,
      data: null,
      error: "Missing configuration. Please contact support.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("performs a successful POST request with JSON body and returns parsed data", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ ok: true, status: 200, json: { data: { ok: true } }, headers: { "x-request-id": "server-id" } }) as unknown as Response
    );

    const result = await invokeEdgeFunction<{ data: { ok: boolean } }>("checkoutReturn", {
      method: "POST",
      body: { itemId: "abc" },
      accessToken: "tok-1",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ data: { ok: true } });
    expect(result.requestId).toBe("server-id");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`${BASE_URL}/checkoutReturn`);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect((init?.headers as Record<string, string>)["x-request-id"]).toBeTruthy();
    expect(init?.credentials).toBe("include");
    expect(JSON.parse(init?.body as string)).toEqual({ itemId: "abc" });
  });

  it("does not attach a body for GET requests even if one is provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, status: 200, json: {} }) as unknown as Response);
    await invokeEdgeFunction("system-status", { method: "GET", body: { ignored: true } });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.body).toBeUndefined();
  });

  it("falls back to null parsed data when the response body is not valid JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ ok: true, status: 204, jsonThrows: true }) as unknown as Response
    );
    const result = await invokeEdgeFunction("client-error-report");
    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
  });

  it("signs out and clears local state when the server reports a tenant/workspace-disabled error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ ok: false, status: 403, json: { error: "Workspace disabled for billing" } }) as unknown as Response
    );

    const result = await invokeEdgeFunction("admin-ops");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toBe("Workspace disabled for billing");
    expect(signOutLocalSupabaseSession).toHaveBeenCalledTimes(1);
    expect(clearAdminVerification).toHaveBeenCalledTimes(1);
    expect(clearAuthState).toHaveBeenCalledWith(true);
  });

  it("recognizes a tenant-disabled message via the 'tenant disabled' phrasing too", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ ok: false, status: 403, json: { message: "tenant disabled" } }) as unknown as Response
    );
    await invokeEdgeFunction("admin-ops");
    expect(signOutLocalSupabaseSession).toHaveBeenCalledTimes(1);
  });

  it("does not sign out for a generic (non-tenant-disabled) failure and reports it via Sentry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ ok: false, status: 422, json: { error: "Invalid barcode format" } }) as unknown as Response
    );

    const result = await invokeEdgeFunction("checkoutReturn", { method: "POST" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.error).toBe("Invalid barcode format");
    expect(result.data).toBeNull();
    expect(signOutLocalSupabaseSession).not.toHaveBeenCalled();
    expect(captureHandledRequestFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        area: "edge_function",
        name: "checkoutReturn",
        method: "POST",
        status: 422,
        message: "Invalid barcode format",
      })
    );
  });

  it("preserves parsed error data when preserveErrorData is set", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ ok: false, status: 400, json: { error: "bad input", extra: 1 } }) as unknown as Response
    );
    const result = await invokeEdgeFunction("checkoutReturn", { preserveErrorData: true });
    expect(result.data).toEqual({ error: "bad input", extra: 1 });
  });

  it("uses a fallback error message when the failure body has neither error nor message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: false, status: 500, json: {} }) as unknown as Response);
    const result = await invokeEdgeFunction("checkoutReturn");
    expect(result.error).toBe("Request failed. Please try again.");
  });

  it("maps an AbortError from fetch to a timed-out result without signing out", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    vi.mocked(fetch).mockRejectedValueOnce(abortError);

    const result = await invokeEdgeFunction("checkoutReturn");

    expect(result).toMatchObject({
      ok: false,
      status: 0,
      data: null,
      error: "Request timed out. Please try again.",
    });
    expect(signOutLocalSupabaseSession).not.toHaveBeenCalled();
  });

  it("maps a generic fetch rejection to a network-failure result", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const result = await invokeEdgeFunction("checkoutReturn");

    expect(result).toMatchObject({
      ok: false,
      status: 0,
      data: null,
      error: "Network request failed.",
    });
  });

  it("automatically retries a single GET timeout once and returns the retry's outcome", async () => {
    const abortError = new DOMException("timeout", "AbortError");
    vi.mocked(fetch)
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, json: { data: "second-try" } }) as unknown as Response);

    const result = await invokeEdgeFunction("system-status", { method: "GET" });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ data: "second-try" });
  });

  it("does not auto-retry a POST timeout", async () => {
    const abortError = new DOMException("timeout", "AbortError");
    vi.mocked(fetch).mockRejectedValueOnce(abortError);

    const result = await invokeEdgeFunction("checkoutReturn", { method: "POST" });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Request timed out. Please try again.");
  });

  it("retries once with a refreshed access token after a 401, and returns the retry's result", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse({ ok: false, status: 401, json: { error: "Unauthorized" } }) as unknown as Response)
      .mockResolvedValueOnce(makeResponse({ ok: true, status: 200, json: { data: "ok" } }) as unknown as Response);

    vi.mocked(supabase.auth.refreshSession).mockResolvedValueOnce({
      data: { session: { access_token: "fresh-token" } },
      error: null,
    } as never);

    const result = await invokeEdgeFunction("checkoutReturn", { method: "POST", accessToken: "stale-token" });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
    const [, secondInit] = vi.mocked(fetch).mock.calls[1];
    expect((secondInit?.headers as Record<string, string>).Authorization).toBe("Bearer fresh-token");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ data: "ok" });
  });

  it("does not retry a 401 when no accessToken was provided on the original request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ ok: false, status: 401, json: { error: "Unauthorized" } }) as unknown as Response
    );

    const result = await invokeEdgeFunction("checkoutReturn");

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
    expect(result.status).toBe(401);
  });

  it("keeps the original 401 result when refreshSession fails to produce a new token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({ ok: false, status: 401, json: { error: "Unauthorized" } }) as unknown as Response
    );
    vi.mocked(supabase.auth.refreshSession).mockResolvedValueOnce({
      data: { session: null },
      error: { message: "no session" },
    } as never);

    const result = await invokeEdgeFunction("checkoutReturn", { accessToken: "stale-token" });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(401);
  });
});
