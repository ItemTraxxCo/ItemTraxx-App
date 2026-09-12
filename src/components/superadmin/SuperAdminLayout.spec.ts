import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import SuperAdminLayout from "./SuperAdminLayout.vue";

const buildRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/super-admin",
        component: SuperAdminLayout,
        children: [
          { path: "", name: "super-admin-home", component: { template: "<div class='stub'>Home content</div>" } },
          { path: "workspaces", name: "super-admin-workspaces", component: { template: "<div />" } },
          { path: "admins", name: "super-admin-admins", component: { template: "<div />" } },
          { path: "tenant-accounts", name: "super-admin-tenant-accounts", component: { template: "<div />" } },
          { path: "super-admins", name: "super-admin-super-admins", component: { template: "<div />" } },
          { path: "items", name: "super-admin-items", component: { template: "<div />" } },
          { path: "borrowers", name: "super-admin-borrowers", component: { template: "<div />" } },
          { path: "broadcasts", name: "super-admin-broadcasts", component: { template: "<div />" } },
          { path: "logs", name: "super-admin-logs", component: { template: "<div />" } },
          { path: "support-requests", name: "super-admin-support-requests", component: { template: "<div />" } },
          { path: "sales-leads", name: "super-admin-sales-leads", component: { template: "<div />" } },
          { path: "customers", name: "super-admin-customers", component: { template: "<div />" } },
          { path: "settings", name: "super-admin-settings", component: { template: "<div />" } },
        ],
      },
      { path: "/internal", name: "internal-ops", component: { template: "<div />" } },
    ],
  });

const mountAt = async (routeName: string) => {
  const router = buildRouter();
  router.push({ name: routeName });
  await router.isReady();
  return mount({ template: "<router-view />" }, { global: { plugins: [router] } });
};

describe("SuperAdminLayout", () => {
  it("renders the sidebar and the matched child route", async () => {
    const wrapper = await mountAt("super-admin-home");
    expect(wrapper.find(".sa-side").exists()).toBe(true);
    expect(wrapper.text()).toContain("Home content");
  });

  it("starts collapsed and expands while the pointer is over the sidebar, collapsing again on mouseleave", async () => {
    const wrapper = await mountAt("super-admin-home");
    const side = wrapper.find(".sa-side");
    expect(side.classes()).toContain("collapsed");

    await side.trigger("mouseenter");
    expect(wrapper.find(".sa-side").classes()).not.toContain("collapsed");

    await side.trigger("mouseleave");
    expect(wrapper.find(".sa-side").classes()).toContain("collapsed");
  });
});
