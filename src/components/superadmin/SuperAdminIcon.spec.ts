import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SuperAdminIcon from "./SuperAdminIcon.vue";

describe("SuperAdminIcon", () => {
  it("renders a path for a path-based icon", () => {
    const wrapper = mount(SuperAdminIcon, { props: { name: "home" } });
    expect(wrapper.find("path").exists()).toBe(true);
  });

  it("renders a circle for an icon with a circle segment", () => {
    const wrapper = mount(SuperAdminIcon, { props: { name: "user" } });
    expect(wrapper.find("circle").exists()).toBe(true);
  });

  it("renders a rect for an icon with a rect segment", () => {
    const wrapper = mount(SuperAdminIcon, { props: { name: "idCard" } });
    expect(wrapper.find("rect").exists()).toBe(true);
  });
});
