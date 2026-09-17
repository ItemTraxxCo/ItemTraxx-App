import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithTransientRetry } from "./fetchWithTransientRetry";

describe("fetchWithTransientRetry", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries a CORS/network TypeError once for a GET", async () => {
    const response = new Response("ok", { status: 200 });
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response);

    await expect(fetchWithTransientRetry("https://edge.example.com/status", {
      method: "GET",
    }, { delayMs: 0 })).resolves.toBe(response);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries an explicit Cloudflare challenge response for a GET", async () => {
    const challenge = new Response("challenge", {
      status: 403,
      headers: { "cf-mitigated": "challenge" },
    });
    const response = new Response("ok", { status: 200 });
    vi.mocked(fetch)
      .mockResolvedValueOnce(challenge)
      .mockResolvedValueOnce(response);

    await expect(fetchWithTransientRetry("https://edge.example.com/status", {
      method: "GET",
    }, { delayMs: 0 })).resolves.toBe(response);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a POST after a network failure", async () => {
    const error = new TypeError("Failed to fetch");
    vi.mocked(fetch).mockRejectedValue(error);

    await expect(fetchWithTransientRetry("https://edge.example.com/mutate", {
      method: "POST",
      body: "{}",
    }, { delayMs: 0 })).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry a GET after the caller aborts it", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = new DOMException("The operation was aborted", "AbortError");
    vi.mocked(fetch).mockRejectedValue(error);

    await expect(fetchWithTransientRetry("https://edge.example.com/status", {
      method: "GET",
      signal: controller.signal,
    }, { delayMs: 0 })).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
