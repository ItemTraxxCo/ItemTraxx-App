import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { useTurnstile } from "./useTurnstile";

type TurnstileApiMock = {
  render: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

const mountHost = (siteKey?: string) => {
  let exposed!: ReturnType<typeof useTurnstile>;
  const Host = defineComponent({
    setup() {
      exposed = useTurnstile(siteKey);
      return () => h("div", { ref: exposed.containerRef });
    },
  });
  const wrapper = mount(Host, { attachTo: document.body });
  return { wrapper, get: () => exposed };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useTurnstile", () => {
  let turnstileApi: TurnstileApiMock;

  beforeEach(() => {
    turnstileApi = {
      render: vi.fn().mockReturnValue("widget-1"),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    delete (window as { turnstile?: unknown }).turnstile;
    document.head.querySelectorAll("script[src*='turnstile']").forEach((el) => el.remove());
  });

  afterEach(() => {
    delete (window as { turnstile?: unknown }).turnstile;
    document.head.querySelectorAll("script[src*='turnstile']").forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  it("does nothing when no siteKey is provided", async () => {
    const { wrapper, get } = mountHost(undefined);
    await flush();

    expect(get().isReady.value).toBe(false);
    expect(document.head.querySelector("script[src*='turnstile']")).toBeNull();
    wrapper.unmount();
  });

  // The next two tests exercise the real script-tag-creation path (the module
  // caches its script-load promise at module scope). The error case runs
  // first so its rejection resets that cache to null; every other test in
  // this file pre-seeds window.turnstile so it never touches that branch.
  it("sets a loadError when the turnstile script fails to load", async () => {
    const { wrapper, get } = mountHost("site-key-1");
    await flush();
    const script = document.head.querySelector<HTMLScriptElement>("script[src*='turnstile']");
    expect(script).not.toBeNull();
    script?.onerror?.(new Event("error"));
    await flush();

    expect(get().loadError.value).toMatch(/unable to load/i);
    wrapper.unmount();
  });

  it("loads the turnstile script and renders the widget when not bypassed", async () => {
    const { wrapper, get } = mountHost("site-key-1");
    await flush();

    const script = document.head.querySelector<HTMLScriptElement>("script[src*='turnstile']");
    expect(script).not.toBeNull();

    (window as unknown as { turnstile: TurnstileApiMock }).turnstile = turnstileApi;
    script?.onload?.(new Event("load"));
    await flush();

    expect(turnstileApi.render).toHaveBeenCalledWith(
      get().containerRef.value,
      expect.objectContaining({ sitekey: "site-key-1", theme: "auto" }),
    );
    expect(get().isReady.value).toBe(true);
    wrapper.unmount();
  });

  it("updates the token via the render callback and clears it on expired-callback", async () => {
    (window as unknown as { turnstile: TurnstileApiMock }).turnstile = turnstileApi;
    const { wrapper, get } = mountHost("site-key-1");
    await flush();

    const renderOptions = turnstileApi.render.mock.calls[0][1];
    renderOptions.callback("captcha-token-abc");
    expect(get().token.value).toBe("captcha-token-abc");

    renderOptions["expired-callback"]();
    expect(get().token.value).toBe("");
    wrapper.unmount();
  });

  it("sets a loadError via the error-callback and clears the token", async () => {
    (window as unknown as { turnstile: TurnstileApiMock }).turnstile = turnstileApi;
    const { wrapper, get } = mountHost("site-key-1");
    await flush();

    const renderOptions = turnstileApi.render.mock.calls[0][1];
    renderOptions["error-callback"]();

    expect(get().token.value).toBe("");
    expect(get().loadError.value).toMatch(/security check failed/i);
    wrapper.unmount();
  });

  it("reset() re-arms the widget and clears the token", async () => {
    (window as unknown as { turnstile: TurnstileApiMock }).turnstile = turnstileApi;
    const { wrapper, get } = mountHost("site-key-1");
    await flush();
    const renderOptions = turnstileApi.render.mock.calls[0][1];
    renderOptions.callback("some-token");

    get().reset();

    expect(turnstileApi.reset).toHaveBeenCalledWith("widget-1");
    expect(get().token.value).toBe("");
    wrapper.unmount();
  });

  it("reset() without a mounted widget clears the token", async () => {
    const { wrapper, get } = mountHost("site-key-1");
    await flush();

    get().reset();

    expect(get().token.value).toBe("");
    wrapper.unmount();
  });

  it("removes the widget on unmount", async () => {
    (window as unknown as { turnstile: TurnstileApiMock }).turnstile = turnstileApi;
    const { wrapper, get } = mountHost("site-key-1");
    await flush();
    expect(get().isReady.value).toBe(true);

    wrapper.unmount();

    expect(turnstileApi.remove).toHaveBeenCalledWith("widget-1");
  });
});
