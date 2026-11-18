import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resetPassword: vi.fn() }));

vi.mock("../auth/client", () => ({ authClient: { resetPassword: mocks.resetPassword } }));

import ResetPassword from "./ResetPassword.vue";

const originalLocation = window.location;
let currentLocation: Record<string, string>;

const stubResetLocation = () => {
  currentLocation = {
    hostname: "app.itemtraxx.com",
    origin: "https://app.itemtraxx.com",
    pathname: "/reset-password",
    search: "?token=one-time-secret&provider=other-secret",
    hash: "#opaque=secret",
  };
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: currentLocation,
  });
};

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("ResetPassword", () => {
  it("redacts the reset URL before a failed reset request and retains the token in memory for the request", async () => {
    stubResetLocation();
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation((_state, _title, url) => {
      const target = new URL(String(url), currentLocation.origin);
      currentLocation.pathname = target.pathname;
      currentLocation.search = target.search;
      currentLocation.hash = target.hash;
    });
    mocks.resetPassword.mockImplementation(async () => {
      expect(replaceState).toHaveBeenCalledWith(
        window.history.state,
        document.title,
        "/reset-password",
      );
      expect(currentLocation.search).toBe("");
      expect(currentLocation.hash).toBe("");
      return { error: { code: "otp_expired" } };
    });

    const wrapper = mount(ResetPassword, {
      global: { stubs: { RouterLink: { template: "<a><slot /></a>" } } },
    });
    await flushPromises();

    expect(currentLocation.search).toBe("");
    expect(currentLocation.hash).toBe("");
    const passwordInputs = wrapper.findAll('input[type="password"]');
    await passwordInputs[0]?.setValue("AveryStrong!234");
    await passwordInputs[1]?.setValue("AveryStrong!234");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mocks.resetPassword).toHaveBeenCalledWith({
      newPassword: "AveryStrong!234",
      token: "one-time-secret",
    });
    expect(wrapper.text()).toContain("Invalid or expired reset link. Request a new reset email.");
    expect(currentLocation.search).toBe("");
    expect(currentLocation.hash).toBe("");
    wrapper.unmount();
  });
});
