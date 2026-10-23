import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import SuperAdminProfileMenu from "./SuperAdminProfileMenu.vue";
import { getAuthState } from "../../store/authState";
import { useTheme } from "../../composables/useTheme";

const routes = [
  { path: "/", name: "root", component: { template: "<div />" } },
  { path: "/login", name: "login", component: { template: "<div />" } },
];

const mountMenu = async (collapsed = false) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  router.push({ name: "root" });
  await router.isReady();
  return mount(SuperAdminProfileMenu, { props: { collapsed }, global: { plugins: [router] } });
};

describe("SuperAdminProfileMenu", () => {
  beforeEach(() => {
    getAuthState().email = "dennis@itemtraxx.com";
    useTheme().setTheme("light");
  });

  afterEach(() => {
    getAuthState().email = null;
    vi.restoreAllMocks();
  });

  it("shows the signed-in admin's email when expanded", async () => {
    const wrapper = await mountMenu(false);
    expect(wrapper.text()).toContain("dennis@itemtraxx.com");
  });

  it("opens the popover with theme toggle and sign out on click", async () => {
    const wrapper = await mountMenu(false);
    expect(wrapper.find(".sa-popover").exists()).toBe(false);
    await wrapper.find(".sa-profile-trigger").trigger("click");
    expect(wrapper.find(".sa-popover").exists()).toBe(true);
    expect(wrapper.text()).toContain("Sign out");
    expect(wrapper.text()).toContain("Dark Mode");
  });

  it("toggles theme and closes the popover", async () => {
    const wrapper = await mountMenu(false);
    await wrapper.find(".sa-profile-trigger").trigger("click");
    await wrapper.findAll(".sa-popover-item")[0].trigger("click");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(wrapper.find(".sa-popover").exists()).toBe(false);
  });

  it("asks for confirmation before signing out, and keeps the popover open if cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = await mountMenu(false);
    await wrapper.find(".sa-profile-trigger").trigger("click");
    await wrapper.findAll(".sa-popover-item")[1].trigger("click");
    expect(confirmSpy).toHaveBeenCalled();
    expect(wrapper.find(".sa-popover").exists()).toBe(true);
  });
});
