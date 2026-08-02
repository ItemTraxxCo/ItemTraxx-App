import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sentry", () => ({
  captureHandledRequestFailure: vi.fn(),
}));

import { authenticatedInsert, authenticatedRpc, authenticatedSelect } from "./authenticatedDataClient";
import { captureHandledRequestFailure } from "./sentry";
import { AppError } from "./appErrors";

type FakeResponseInit = {
  ok: boolean;
  status: number;
  text?: string;
  headers?: Record<string, string>;
};

const makeResponse = ({ ok, status, text = "", headers = {} }: FakeResponseInit) => ({
  ok,
  status,
  headers: { get: (name: string) => headers[name] ?? null },
  text: async () => text,
});

const flushMicrotasks = () => new Promise((resolve) => queueMicrotask(() => resolve(undefined)));

describe("authenticatedDataClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe("authenticatedSelect", () => {
    it("issues a GET with query params, credentials included, and no data-request header", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ ok: true, status: 200, text: JSON.stringify({ items: [] }) }) as unknown as Response
      );

      const result = await authenticatedSelect<{ items: unknown[] }>("items", { select: "*" });

      expect(result).toEqual({ items: [] });
      const [url, init] = vi.mocked(fetch).mock.calls[0];
      expect(String(url)).toContain("/rest/v1/items?select=*");
      expect(init?.credentials).toBe("include");
      expect((init?.headers as Record<string, string>).Accept).toBe("application/json");
      expect((init?.headers as Record<string, string>)["x-itx-data-request"]).toBeUndefined();
    });

    it("attaches a Prefer header when provided", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, status: 200, text: "[]" }) as unknown as Response);
      await authenticatedSelect("items", {}, { prefer: "count=exact" });
      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect((init?.headers as Record<string, string>).Prefer).toBe("count=exact");
    });

    it("supports the HEAD method", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, status: 200, text: "" }) as unknown as Response);
      await authenticatedSelect("items", {}, { method: "HEAD" });
      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect(init?.method).toBe("HEAD");
    });

    it("returns null for an empty response body", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, status: 200, text: "" }) as unknown as Response);
      const result = await authenticatedSelect("items", {});
      expect(result).toBeNull();
    });

    it("returns null for a 204 No Content response without reading the body", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, status: 204, text: "" }) as unknown as Response);
      const result = await authenticatedSelect("items", {});
      expect(result).toBeNull();
    });
  });

  describe("authenticatedInsert", () => {
    it("issues a POST with JSON content-type and the data-request header", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ ok: true, status: 201, text: JSON.stringify({ id: "1" }) }) as unknown as Response
      );
      const result = await authenticatedInsert("items", { name: "Widget" });
      expect(result).toEqual({ id: "1" });
      const [url, init] = vi.mocked(fetch).mock.calls[0];
      expect(String(url)).toContain("/rest/v1/items");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect((init?.headers as Record<string, string>)["x-itx-data-request"]).toBe("1");
      expect(JSON.parse(init?.body as string)).toEqual({ name: "Widget" });
    });

    it("attaches a Prefer header when provided", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, status: 201, text: "{}" }) as unknown as Response);
      await authenticatedInsert("items", { name: "x" }, { prefer: "return=representation" });
      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect((init?.headers as Record<string, string>).Prefer).toBe("return=representation");
    });

    it("supports inserting an array payload", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, status: 201, text: "[]" }) as unknown as Response);
      await authenticatedInsert("items", [{ name: "a" }, { name: "b" }]);
      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(init?.body as string)).toEqual([{ name: "a" }, { name: "b" }]);
    });
  });

  describe("authenticatedRpc", () => {
    it("posts to /rpc/<fn> with a JSON body and parses the result", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, status: 200, text: "true" }) as unknown as Response);
      const result = await authenticatedRpc<boolean>("consume_rate_limit", { key: "x" });
      expect(result).toBe(true);
      const [url, init] = vi.mocked(fetch).mock.calls[0];
      expect(String(url)).toContain("/rpc/consume_rate_limit");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({ key: "x" });
    });
  });

  describe("error handling", () => {
    it("throws unauthorized and dispatches recovery for a 401", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ ok: false, status: 401, text: JSON.stringify({ message: "no token" }) }) as unknown as Response
      );
      const listener = vi.fn();
      window.addEventListener("itemtraxx:recoverable-app-error", listener as EventListener);

      await expect(authenticatedSelect("items", {})).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
      await flushMicrotasks();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(captureHandledRequestFailure).toHaveBeenCalledWith(
        expect.objectContaining({ area: "authenticated_data", status: 401, message: "no token" })
      );
      window.removeEventListener("itemtraxx:recoverable-app-error", listener as EventListener);
    });

    it("does not dispatch recovery for a 401 when suppressUnauthorizedRecovery is set", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: false, status: 401, text: "{}" }) as unknown as Response);
      const listener = vi.fn();
      window.addEventListener("itemtraxx:recoverable-app-error", listener as EventListener);

      await expect(
        authenticatedSelect("items", {}, { suppressUnauthorizedRecovery: true })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401, reportToSentry: false });
      await flushMicrotasks();
      expect(listener).not.toHaveBeenCalled();
      window.removeEventListener("itemtraxx:recoverable-app-error", listener as EventListener);
    });

    it("treats a 403 permission-denied message as unauthorized", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 403,
          text: JSON.stringify({ error: "permission denied for table items" }),
        }) as unknown as Response
      );
      await expect(authenticatedSelect("items", {})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("does not treat an unrelated 403 as unauthorized", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ ok: false, status: 403, text: JSON.stringify({ error: "forbidden action" }) }) as unknown as Response
      );
      await expect(authenticatedSelect("items", {})).rejects.toMatchObject({ code: "REQUEST_FAILED", status: 403 });
    });

    it("suppresses recovery for a 403 permission-denied message when the flag is set", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ ok: false, status: 403, text: JSON.stringify({ error: "permission denied" }) }) as unknown as Response
      );
      await expect(
        authenticatedSelect("items", {}, { suppressUnauthorizedRecovery: true })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 403, reportToSentry: false });
    });

    it("marks 5xx failures as reportable and non-5xx failures as not", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: false, status: 500, text: "{}" }) as unknown as Response);
      const serverError = (await authenticatedSelect("items", {}).catch((error) => error)) as AppError;
      expect(serverError).toBeInstanceOf(AppError);
      expect(serverError.reportToSentry).toBe(true);

      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ ok: false, status: 422, text: JSON.stringify({ error: "bad input" }) }) as unknown as Response
      );
      const clientError = (await authenticatedSelect("items", {}).catch((error) => error)) as AppError;
      expect(clientError.reportToSentry).toBe(false);
    });

    it("falls back to a generic message when the error body is empty or not JSON", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: false, status: 500, text: "not json" }) as unknown as Response);
      await expect(authenticatedSelect("items", {})).rejects.toMatchObject({
        message: "Whoops! Authenticated data request failed (500).",
      });
    });

    it("prefers the error field over message when both could apply, and falls back to error alone", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeResponse({ ok: false, status: 500, text: JSON.stringify({ error: "db down" }) }) as unknown as Response
      );
      await expect(authenticatedSelect("items", {})).rejects.toMatchObject({ message: "db down" });
    });
  });

  describe("getBaseUrl / getProxyOrigin", () => {
    it("uses the proxy origin in production when configured", async () => {
      vi.stubEnv("DEV", false);
      vi.stubEnv("VITE_EDGE_PROXY_URL", "https://proxy.example.com/v1/");
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, status: 200, text: "[]" }) as unknown as Response);
      await authenticatedSelect("items", {});
      const [url] = vi.mocked(fetch).mock.calls[0];
      expect(String(url)).toBe("https://proxy.example.com/rest/v1/items?");
    });

    it("uses a relative base in production when no proxy is configured", async () => {
      vi.stubEnv("DEV", false);
      vi.stubEnv("VITE_EDGE_PROXY_URL", "");
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, status: 200, text: "[]" }) as unknown as Response);
      await authenticatedSelect("items", {});
      const [url] = vi.mocked(fetch).mock.calls[0];
      expect(String(url)).toBe("/rest/v1/items?");
    });

    it("throws a configuration error in dev when no proxy URL is set, without calling fetch", async () => {
      vi.stubEnv("DEV", true);
      vi.stubEnv("VITE_EDGE_PROXY_URL", "");
      await expect(authenticatedSelect("items", {})).rejects.toThrow(
        "Missing edge proxy config for authenticated data requests. Please contact support."
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it("falls back to trimming a trailing slash when the proxy URL is not a valid absolute URL", async () => {
      vi.stubEnv("DEV", true);
      vi.stubEnv("VITE_EDGE_PROXY_URL", "not-a-valid-url/");
      vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, status: 200, text: "[]" }) as unknown as Response);
      await authenticatedSelect("items", {});
      const [url] = vi.mocked(fetch).mock.calls[0];
      expect(String(url)).toBe("not-a-valid-url/rest/v1/items?");
    });
  });
});
