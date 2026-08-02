import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { useTopBannerLayout, type TopBannerElements } from "./useTopBannerLayout";

const mountHost = () => {
  let exposed!: ReturnType<typeof useTopBannerLayout>;
  const Host = defineComponent({
    setup() {
      exposed = useTopBannerLayout();
      return () => h("div");
    },
  });
  const wrapper = mount(Host);
  return { wrapper, get: () => exposed };
};

const elementWithHeight = (height: number): HTMLElement => {
  const el = document.createElement("div");
  Object.defineProperty(el, "offsetHeight", { configurable: true, value: height });
  return el;
};

describe("useTopBannerLayout", () => {
  let observeSpy: ReturnType<typeof vi.fn>;
  let disconnectSpy: ReturnType<typeof vi.fn>;
  let ResizeObserverCtor: ReturnType<typeof vi.fn>;
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(() => {
    observeSpy = vi.fn();
    disconnectSpy = vi.fn();
    ResizeObserverCtor = vi.fn().mockImplementation(function FakeResizeObserver(this: {
      observe: typeof observeSpy;
      disconnect: typeof disconnectSpy;
    }) {
      this.observe = observeSpy;
      this.disconnect = disconnectSpy;
    });
    originalResizeObserver = window.ResizeObserver;
    vi.stubGlobal("ResizeObserver", ResizeObserverCtor);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalResizeObserver) window.ResizeObserver = originalResizeObserver;
    vi.restoreAllMocks();
  });

  it("starts with zero heights and a 0px offset", () => {
    const { wrapper, get } = mountHost();
    expect(get().topOffsetPx.value).toBe("0px");
    expect(get().appShellStyle.value).toEqual({ "--top-banner-offset": "0px" });
    wrapper.unmount();
  });

  it("measures each banner element's offsetHeight and sums them into topOffsetPx", async () => {
    const { wrapper, get } = mountHost();
    const elements: TopBannerElements = {
      maintenance: elementWithHeight(20),
      broadcast: elementWithHeight(30),
      incident: null,
    };
    get().setElements(elements);
    await nextTick();

    expect(get().topOffsetPx.value).toBe("50px");
    expect(get().appShellStyle.value).toEqual({ "--top-banner-offset": "50px" });
    wrapper.unmount();
  });

  it("treats missing elements as zero height", async () => {
    const { wrapper, get } = mountHost();
    get().setElements({ maintenance: null, broadcast: null, incident: elementWithHeight(15) });
    await nextTick();

    expect(get().topOffsetPx.value).toBe("15px");
    wrapper.unmount();
  });

  it("observes every non-null element with a ResizeObserver when set", () => {
    const { wrapper, get } = mountHost();
    const maintenance = elementWithHeight(10);
    const broadcast = elementWithHeight(10);
    get().setElements({ maintenance, broadcast, incident: null });

    expect(ResizeObserverCtor).toHaveBeenCalled();
    expect(observeSpy).toHaveBeenCalledWith(maintenance);
    expect(observeSpy).toHaveBeenCalledWith(broadcast);
    expect(observeSpy).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("disconnects the previous observer before creating a new one on repeated setElements calls", () => {
    const { wrapper, get } = mountHost();
    get().setElements({ maintenance: elementWithHeight(10), broadcast: null, incident: null });
    get().setElements({ maintenance: elementWithHeight(20), broadcast: null, incident: null });

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(ResizeObserverCtor).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("gracefully skips observing when ResizeObserver is unavailable", () => {
    vi.unstubAllGlobals();
    // @ts-expect-error -- simulate an environment without ResizeObserver support
    delete window.ResizeObserver;
    const { wrapper, get } = mountHost();

    expect(() => get().setElements({ maintenance: elementWithHeight(5), broadcast: null, incident: null })).not.toThrow();
    wrapper.unmount();
  });

  it("re-measures on a window resize event", async () => {
    const { wrapper, get } = mountHost();
    const maintenance = elementWithHeight(10);
    get().setElements({ maintenance, broadcast: null, incident: null });
    await nextTick();
    expect(get().topOffsetPx.value).toBe("10px");

    Object.defineProperty(maintenance, "offsetHeight", { configurable: true, value: 40 });
    window.dispatchEvent(new Event("resize"));

    expect(get().topOffsetPx.value).toBe("40px");
    wrapper.unmount();
  });

  it("removes the resize listener and disconnects the observer on unmount", () => {
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    const { wrapper, get } = mountHost();
    get().setElements({ maintenance: elementWithHeight(10), broadcast: null, incident: null });

    wrapper.unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it("measures once via nextTick after mount even without setElements", async () => {
    const { wrapper, get } = mountHost();
    await nextTick();
    expect(get().topOffsetPx.value).toBe("0px");
    wrapper.unmount();
  });
});
