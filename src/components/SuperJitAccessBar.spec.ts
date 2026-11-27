import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequestJit, mockInvokeBreakGlass, mockRevokeJit } = vi.hoisted(() => ({
  mockRequestJit: vi.fn(),
  mockInvokeBreakGlass: vi.fn(),
  mockRevokeJit: vi.fn(),
}));

vi.mock("vue-router", () => ({
  RouterLink: {
    props: ["to"],
    template: "<a :href=\"to\"><slot /></a>",
  },
  useRoute: () => ({ path: "/super-admin/items" }),
}));

vi.mock("../services/superOps/jitAccess", () => ({
  requestJitSupportTicket: mockRequestJit,
  invokeBreakGlassAccess: mockInvokeBreakGlass,
  revokeJitSupportTicket: mockRevokeJit,
}));

import SuperJitAccessBar from "./SuperJitAccessBar.vue";
import { edgeFunctionError } from "../services/appErrors";
import { clearActiveJitSession } from "../store/jitAccessState";

describe("SuperJitAccessBar", () => {
  beforeEach(() => {
    clearActiveJitSession();
    mockRequestJit.mockReset();
    mockInvokeBreakGlass.mockReset();
    mockRevokeJit.mockReset();
  });

  it("renders step-up expiry errors inside the modal with a re-verify link", async () => {
    mockRequestJit.mockRejectedValueOnce(
      edgeFunctionError({ status: 403, error: "Super admin verification required." }, "fallback"),
    );

    const wrapper = mount(SuperJitAccessBar, {
      props: {
        workspaces: [{ id: "ws-1", name: "ITX Demo Workspace" }],
        defaultWorkspaceId: "ws-1",
      },
    });

    await wrapper.get("button.primary").trigger("click");
    const modal = wrapper.get(".jit-modal");
    await modal.get('input[type="text"]').setValue("SUP-1");
    await modal.get("textarea").setValue("Test reason");
    await modal.get("form").trigger("submit");
    await flushPromises();

    const alert = modal.get('[role="alert"]');
    expect(alert.text()).toContain("Super admin verification expired");
    const link = alert.get("a.jit-reverify-link");
    expect(link.attributes("href")).toBe("/super-auth");
    wrapper.unmount();
  });
});
