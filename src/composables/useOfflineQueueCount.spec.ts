import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { useOfflineQueueCount } from "./useOfflineQueueCount";

// The composable pulls these two in via dynamic import() so they only load when
// a tenant-scoped route needs the badge. Mock both at the module boundary so we
// control the counts without touching real storage/crypto.
vi.mock("../services/offlineCheckoutQueue", () => ({
  getOfflineQueueSummary: vi.fn(),
}));
vi.mock("../services/offlineCheckoutWorkflow", () => ({
  getOfflineWorkflowSummary: vi.fn(),
}));

import { getOfflineQueueSummary } from "../services/offlineCheckoutQueue";
import { getOfflineWorkflowSummary } from "../services/offlineCheckoutWorkflow";

const mockedGetOfflineQueueSummary = vi.mocked(getOfflineQueueSummary);
const mockedGetOfflineWorkflowSummary = vi.mocked(getOfflineWorkflowSummary);

const emptySummary = {
  pack: null,
  packExpired: false,
  pendingCount: 0,
  syncingCount: 0,
  reviewCount: 0,
};

const emptyLegacySummary = {
  totalCount: 0,
  pendingCount: 0,
  reviewCount: 0,
};

const mountHost = (isTenantScopedRoute: Ref<boolean>) => {
  let exposed!: ReturnType<typeof useOfflineQueueCount>;
  const Host = defineComponent({
    setup() {
      exposed = useOfflineQueueCount(isTenantScopedRoute);
      return () => h("div");
    },
  });
  const wrapper = mount(Host);
  return { wrapper, get: () => exposed };
};

describe("useOfflineQueueCount", () => {
  beforeEach(() => {
    mockedGetOfflineQueueSummary.mockReset();
    mockedGetOfflineWorkflowSummary.mockReset();
    document.dispatchEvent(new Event("visibilitychange")); // no-op safety, keeps state real
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays at zero and never queries storage when the current route is not tenant-scoped", async () => {
    const isTenantScopedRoute = ref(false);
    const { wrapper } = mountHost(isTenantScopedRoute);
    await nextTick();

    expect(mockedGetOfflineQueueSummary).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("sums the legacy buffered count with the workflow's pending + review counts once mounted on a tenant-scoped route", async () => {
    mockedGetOfflineQueueSummary.mockResolvedValue({ ...emptyLegacySummary, totalCount: 2, pendingCount: 2 });
    mockedGetOfflineWorkflowSummary.mockResolvedValue({ ...emptySummary, pendingCount: 3, reviewCount: 1, syncingCount: 1 });

    const isTenantScopedRoute = ref(true);
    const { wrapper, get } = mountHost(isTenantScopedRoute);

    await vi.waitFor(() => expect(get().count.value).toBe(6)); // 2 legacy + 3 pending + 1 review
    expect(get().syncingCount.value).toBe(1);
    expect(get().reviewCount.value).toBe(1);
    wrapper.unmount();
  });

  it("resets to zero and stops polling when the route stops being tenant-scoped", async () => {
    mockedGetOfflineQueueSummary.mockResolvedValue({ ...emptyLegacySummary, totalCount: 4, pendingCount: 4 });
    mockedGetOfflineWorkflowSummary.mockResolvedValue({ ...emptySummary, pendingCount: 0 });

    const isTenantScopedRoute = ref(true);
    const { wrapper, get } = mountHost(isTenantScopedRoute);
    await vi.waitFor(() => expect(get().count.value).toBe(4));

    isTenantScopedRoute.value = false;
    await nextTick();

    expect(get().count.value).toBe(0);
    expect(get().syncingCount.value).toBe(0);
    expect(get().reviewCount.value).toBe(0);
    wrapper.unmount();
  });

  it("resets to zero on any refresh failure instead of surfacing a stale or partial count", async () => {
    mockedGetOfflineQueueSummary.mockRejectedValue(new Error("storage unavailable"));
    mockedGetOfflineWorkflowSummary.mockResolvedValue(emptySummary);

    const isTenantScopedRoute = ref(true);
    const { wrapper, get } = mountHost(isTenantScopedRoute);

    await vi.waitFor(() => expect(mockedGetOfflineWorkflowSummary).toHaveBeenCalled());
    expect(get().count.value).toBe(0);
    expect(get().syncingCount.value).toBe(0);
    expect(get().reviewCount.value).toBe(0);
    wrapper.unmount();
  });

  it("re-polls on a storage event for the offline buffer key and ignores unrelated storage events", async () => {
    mockedGetOfflineQueueSummary.mockResolvedValue({ ...emptyLegacySummary, totalCount: 1, pendingCount: 1 });
    mockedGetOfflineWorkflowSummary.mockResolvedValue(emptySummary);

    const isTenantScopedRoute = ref(true);
    const { wrapper, get } = mountHost(isTenantScopedRoute);
    await vi.waitFor(() => expect(get().count.value).toBe(1));
    const callsBefore = mockedGetOfflineQueueSummary.mock.calls.length;

    window.dispatchEvent(new StorageEvent("storage", { key: "some-unrelated-key" }));
    await nextTick();
    expect(mockedGetOfflineQueueSummary.mock.calls.length).toBe(callsBefore);

    window.dispatchEvent(new StorageEvent("storage", { key: "itemtraxx:checkout-offline-buffer:v1" }));
    await vi.waitFor(() => expect(mockedGetOfflineQueueSummary.mock.calls.length).toBe(callsBefore + 1));

    wrapper.unmount();
  });

  it("re-polls when the offline-workflow-changed event fires", async () => {
    mockedGetOfflineQueueSummary.mockResolvedValue(emptyLegacySummary);
    mockedGetOfflineWorkflowSummary.mockResolvedValue(emptySummary);

    const isTenantScopedRoute = ref(true);
    const { wrapper, get } = mountHost(isTenantScopedRoute);
    await vi.waitFor(() => expect(get().count.value).toBe(0));
    const callsBefore = mockedGetOfflineWorkflowSummary.mock.calls.length;

    window.dispatchEvent(new CustomEvent("itemtraxx:offline-workflow-changed"));
    await vi.waitFor(() => expect(mockedGetOfflineWorkflowSummary.mock.calls.length).toBe(callsBefore + 1));

    wrapper.unmount();
  });

  it("re-polls when a legacy queue review item is created or discarded", async () => {
    mockedGetOfflineQueueSummary.mockResolvedValue(emptyLegacySummary);
    mockedGetOfflineWorkflowSummary.mockResolvedValue(emptySummary);

    const isTenantScopedRoute = ref(true);
    const { wrapper } = mountHost(isTenantScopedRoute);
    await vi.waitFor(() => expect(mockedGetOfflineQueueSummary).toHaveBeenCalled());
    const callsBefore = mockedGetOfflineQueueSummary.mock.calls.length;

    window.dispatchEvent(new CustomEvent("itemtraxx:offline-queue-changed"));
    await vi.waitFor(() => expect(mockedGetOfflineQueueSummary.mock.calls.length).toBe(callsBefore + 1));

    wrapper.unmount();
  });

  it("stops polling when the tab becomes hidden and resumes when it becomes visible again", async () => {
    mockedGetOfflineQueueSummary.mockResolvedValue(emptyLegacySummary);
    mockedGetOfflineWorkflowSummary.mockResolvedValue(emptySummary);

    const isTenantScopedRoute = ref(true);
    const { wrapper, get } = mountHost(isTenantScopedRoute);
    await vi.waitFor(() => expect(get().count.value).toBe(0));
    const callsBefore = mockedGetOfflineWorkflowSummary.mock.calls.length;

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await nextTick();
    // Going hidden should not itself trigger a fresh poll, and count/syncingCount reset.
    expect(mockedGetOfflineWorkflowSummary.mock.calls.length).toBe(callsBefore);
    expect(get().count.value).toBe(0);

    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(mockedGetOfflineWorkflowSummary.mock.calls.length).toBe(callsBefore + 1));

    wrapper.unmount();
  });

  it("exposes a static tooltip describing the offline queue", () => {
    const isTenantScopedRoute = ref(false);
    const { wrapper, get } = mountHost(isTenantScopedRoute);
    expect(get().tooltip.value).toMatch(/offline queue/i);
    wrapper.unmount();
  });

  it("removes its listeners and stops the poll timer on unmount", async () => {
    mockedGetOfflineQueueSummary.mockResolvedValue(emptyLegacySummary);
    mockedGetOfflineWorkflowSummary.mockResolvedValue(emptySummary);
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const isTenantScopedRoute = ref(true);
    const { wrapper, get } = mountHost(isTenantScopedRoute);
    await vi.waitFor(() => expect(get().count.value).toBe(0));

    wrapper.unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("storage", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("itemtraxx:offline-queue-changed", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith("itemtraxx:offline-workflow-changed", expect.any(Function));
  });
});
