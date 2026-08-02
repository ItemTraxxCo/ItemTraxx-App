import { afterEach, describe, expect, it, vi } from "vitest";
import { getEdgeFunctionsBaseUrl } from "./edgeUrls";

describe("getEdgeFunctionsBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("appends /functions to a configured proxy URL", () => {
    vi.stubEnv("VITE_EDGE_PROXY_URL", "https://proxy.example.com");
    expect(getEdgeFunctionsBaseUrl()).toBe("https://proxy.example.com/functions");
  });

  it("trims a trailing slash before appending /functions", () => {
    vi.stubEnv("VITE_EDGE_PROXY_URL", "https://proxy.example.com/");
    expect(getEdgeFunctionsBaseUrl()).toBe("https://proxy.example.com/functions");
  });

  it("trims multiple trailing slashes", () => {
    vi.stubEnv("VITE_EDGE_PROXY_URL", "https://proxy.example.com///");
    expect(getEdgeFunctionsBaseUrl()).toBe("https://proxy.example.com/functions");
  });

  it("trims surrounding whitespace around the configured URL", () => {
    vi.stubEnv("VITE_EDGE_PROXY_URL", "  https://proxy.example.com  ");
    expect(getEdgeFunctionsBaseUrl()).toBe("https://proxy.example.com/functions");
  });

  it("falls back to a relative /functions path when unset", () => {
    vi.stubEnv("VITE_EDGE_PROXY_URL", "");
    expect(getEdgeFunctionsBaseUrl()).toBe("/functions");
  });

  it("falls back to a relative /functions path for a whitespace-only value", () => {
    vi.stubEnv("VITE_EDGE_PROXY_URL", "   ");
    expect(getEdgeFunctionsBaseUrl()).toBe("/functions");
  });
});
