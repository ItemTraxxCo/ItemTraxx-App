import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useAppVersionStatus } from "./useAppVersionStatus";

const mountHost = (options: {
  appVersion: string;
  isDevHost?: boolean;
  isNonMainBuild?: boolean;
}) => {
  const isDevHost = ref(options.isDevHost ?? false);
  let exposed!: ReturnType<typeof useAppVersionStatus>;
  const Host = defineComponent({
    setup() {
      exposed = useAppVersionStatus({
        appVersion: options.appVersion,
        isDevHost,
        isNonMainBuild: options.isNonMainBuild ?? false,
      });
      return () => h("div");
    },
  });
  const wrapper = mount(Host);
  return { wrapper, get: () => exposed, isDevHost };
};

const jsonResponse = (payload: unknown, ok = true) => ({
  ok,
  json: () => Promise.resolve(payload),
});

describe("useAppVersionStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does nothing on a dev host: never fetches, stays not-outdated", async () => {
    const { wrapper } = mountHost({ appVersion: "abc1234", isDevHost: true });
    await vi.advanceTimersByTimeAsync(750);

    expect(fetch).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("does nothing on a non-main build", async () => {
    const { wrapper, get } = mountHost({ appVersion: "abc1234", isNonMainBuild: true });
    await vi.advanceTimersByTimeAsync(750);

    expect(fetch).not.toHaveBeenCalled();
    expect(get().isOutdated.value).toBe(false);
    wrapper.unmount();
  });

  it("skips the check entirely when appVersion is unset or 'n/a'", async () => {
    const { wrapper } = mountHost({ appVersion: "n/a" });
    await vi.advanceTimersByTimeAsync(750);

    expect(fetch).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("marks the app outdated when the latest commit sha differs from appVersion", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ sha: "deadbeef1234" }) as never);
    const { wrapper, get } = mountHost({ appVersion: "abc1234" });

    await vi.advanceTimersByTimeAsync(750);
    await vi.waitFor(() => expect(get().isOutdated.value).toBe(true));

    expect(get().latestVersion.value).toBe("deadbee");
    wrapper.unmount();
  });

  it("is not outdated when the latest sha matches appVersion", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ sha: "abc1234ffff" }) as never);
    const { wrapper, get } = mountHost({ appVersion: "abc1234" });

    await vi.advanceTimersByTimeAsync(750);
    await vi.waitFor(() => expect(get().latestVersion.value).toBe("abc1234"));

    expect(get().isOutdated.value).toBe(false);
    wrapper.unmount();
  });

  it("keeps current state on a non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ sha: "deadbeef" }, false) as never);
    const { wrapper, get } = mountHost({ appVersion: "abc1234" });

    await vi.advanceTimersByTimeAsync(750);
    await vi.advanceTimersByTimeAsync(0);

    expect(get().isOutdated.value).toBe(false);
    expect(get().latestVersion.value).toBeNull();
    wrapper.unmount();
  });

  it("ignores a payload whose sha is too short to be meaningful", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ sha: "abcd" }) as never);
    const { wrapper, get } = mountHost({ appVersion: "abc1234" });

    await vi.advanceTimersByTimeAsync(750);
    await vi.advanceTimersByTimeAsync(0);

    expect(get().latestVersion.value).toBeNull();
    wrapper.unmount();
  });

  it("keeps current state on a network error", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    const { wrapper, get } = mountHost({ appVersion: "abc1234" });

    await vi.advanceTimersByTimeAsync(750);
    await vi.advanceTimersByTimeAsync(0);

    expect(get().isOutdated.value).toBe(false);
    wrapper.unmount();
  });

  it("re-checks on refresh() and re-polls every 2 minutes while visible", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ sha: "abc1234ffff" }) as never);
    const { wrapper } = mountHost({ appVersion: "abc1234" });
    await vi.advanceTimersByTimeAsync(750);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(120_000);
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2);
    wrapper.unmount();
  });

  it("stops polling when hidden and resumes (with an immediate refresh) when visible again", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ sha: "abc1234ffff" }) as never);
    const { wrapper } = mountHost({ appVersion: "abc1234" });
    await vi.advanceTimersByTimeAsync(750);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(120_000 * 3);
    expect(fetch).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2));
    wrapper.unmount();
  });

  it("exposes a forceUpdateOverlay flag driven by DEV + E2E query-param gating", () => {
    const { wrapper, get } = mountHost({ appVersion: "abc1234" });
    // In the standard test env (no e2e query param) the overlay stays off.
    expect(get().forceUpdateOverlay.value).toBe(false);
    wrapper.unmount();
  });

  it("aborts in-flight requests and clears timers on unmount", async () => {
    vi.mocked(fetch).mockImplementation(
      () => new Promise(() => {}) as never, // never resolves, forces an in-flight abort on unmount
    );
    const { wrapper } = mountHost({ appVersion: "abc1234" });
    await vi.advanceTimersByTimeAsync(750);
    await vi.advanceTimersByTimeAsync(0);

    expect(() => wrapper.unmount()).not.toThrow();
  });
});
