import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flow: null as { step: "approve" | "verify"; token: string } | null,
  takeToken: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("../services/accountFlowToken", () => ({
  takeAccountEmailChangeToken: mocks.takeToken,
}));

vi.mock("../services/accountEmailChangeService", () => ({
  completeAccountEmailChangeStep: mocks.complete,
}));

import AccountEmailChange from "./AccountEmailChange.vue";

describe("AccountEmailChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flow = { step: "approve", token: "a".repeat(64) };
    mocks.takeToken.mockImplementation(() => mocks.flow);
    mocks.complete.mockResolvedValue({ success: true, message: "Email change confirmed." });
  });

  it.each([
    { step: "approve" as const, button: "Approve email change" },
    { step: "verify" as const, button: "Confirm new email" },
  ])("does not consume the $step token until the owner clicks", async ({ step, button }) => {
    mocks.flow = { step, token: "b".repeat(64) };
    const wrapper = mount(AccountEmailChange, {
      global: {
        stubs: { RouterLink: true },
        directives: { "app-toast-error": {} },
      },
    });
    await flushPromises();

    expect(mocks.takeToken).toHaveBeenCalledOnce();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain(button);

    await wrapper.get("button.button-primary").trigger("click");
    await flushPromises();

    expect(mocks.complete).toHaveBeenCalledWith(step, "b".repeat(64));
    expect(wrapper.text()).toContain("Email change confirmed.");
    wrapper.unmount();
  });
});
