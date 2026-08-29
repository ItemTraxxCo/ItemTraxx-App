import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import OfflineQueueToast from "./OfflineQueueToast.vue";

const props = {
  enabled: true,
  count: 1,
  syncingCount: 0,
  reviewCount: 0,
  tooltip: "Offline queue",
};

describe("OfflineQueueToast", () => {
  it("describes review-required work separately from transactions waiting to sync", () => {
    const wrapper = mount(OfflineQueueToast, {
      props: { ...props, reviewCount: 1 },
    });

    expect(wrapper.text()).toContain("Offline queue needs review");
    expect(wrapper.text()).toContain("need review before they can be replayed");
    expect(wrapper.text()).not.toContain("waiting to sync");
  });

  it("does not retain queue or completion UI outside workspace-scoped routes", async () => {
    const wrapper = mount(OfflineQueueToast, { props });
    expect(wrapper.isVisible()).toBe(true);

    await wrapper.setProps({ enabled: false });

    expect(wrapper.find(".toast").exists()).toBe(false);
  });
});
