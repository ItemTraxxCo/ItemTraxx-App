import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { useSystemStatus } from "./useSystemStatus";
import { systemStatusState } from "../store/systemStatusState";

// systemStatusState is a real reactive singleton with its own thorough spec
// (src/store/systemStatusState.spec.ts). Here we only verify this composable
// wires acquire()/release() into the component lifecycle correctly.
vi.mock("../store/systemStatusState", () => ({
  systemStatusState: {
    acquire: vi.fn(),
    release: vi.fn(),
    state: {},
    statusLabel: { value: "Running" },
    statusClass: { value: "status-ok" },
    refresh: vi.fn(),
  },
}));

const mockedAcquire = vi.mocked(systemStatusState.acquire);
const mockedRelease = vi.mocked(systemStatusState.release);

const mountHost = () => {
  let exposed!: ReturnType<typeof useSystemStatus>;
  const Host = defineComponent({
    setup() {
      exposed = useSystemStatus();
      return () => h("div");
    },
  });
  const wrapper = mount(Host);
  return { wrapper, get: () => exposed };
};

describe("useSystemStatus", () => {
  afterEach(() => {
    mockedAcquire.mockClear();
    mockedRelease.mockClear();
    vi.restoreAllMocks();
  });

  it("calls systemStatusState.acquire() on mount", () => {
    const { wrapper } = mountHost();
    expect(mockedAcquire).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("calls systemStatusState.release() on unmount, not before", () => {
    const { wrapper } = mountHost();
    expect(mockedRelease).not.toHaveBeenCalled();

    wrapper.unmount();

    expect(mockedRelease).toHaveBeenCalledTimes(1);
  });

  it("returns the systemStatusState singleton itself", () => {
    const { wrapper, get } = mountHost();
    expect(get()).toBe(systemStatusState);
    wrapper.unmount();
  });

  it("each mounted instance acquires and releases independently", () => {
    const first = mountHost();
    const second = mountHost();
    expect(mockedAcquire).toHaveBeenCalledTimes(2);

    first.wrapper.unmount();
    expect(mockedRelease).toHaveBeenCalledTimes(1);

    second.wrapper.unmount();
    expect(mockedRelease).toHaveBeenCalledTimes(2);
  });
});
