import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import SuperAdminSidebar from "./SuperAdminSidebar.vue";

const routes = [
  { path: "/super-admin", name: "super-admin-home", component: { template: "<div />" } },
  { path: "/super-admin/workspaces", name: "super-admin-workspaces", component: { template: "<div />" } },
  { path: "/super-admin/admins", name: "super-admin-admins", component: { template: "<div />" } },
  { path: "/super-admin/tenant-accounts", name: "super-admin-tenant-accounts", component: { template: "<div />" } },
  { path: "/super-admin/super-admins", name: "super-admin-super-admins", component: { template: "<div />" } },
  { path: "/super-admin/items", name: "super-admin-items", component: { template: "<div />" } },
  { path: "/super-admin/borrowers", name: "super-admin-borrowers", component: { template: "<div />" } },
  { path: "/super-admin/broadcasts", name: "super-admin-broadcasts", component: { template: "<div />" } },
  { path: "/super-admin/logs", name: "super-admin-logs", component: { template: "<div />" } },
  { path: "/internal", name: "internal-ops", component: { template: "<div />" } },
  { path: "/super-admin/support-requests", name: "super-admin-support-requests", component: { template: "<div />" } },
  { path: "/super-admin/sales-leads", name: "super-admin-sales-leads", component: { template: "<div />" } },
  { path: "/super-admin/customers", name: "super-admin-customers", component: { template: "<div />" } },
  { path: "/super-admin/settings", name: "super-admin-settings", component: { template: "<div />" } },
];

const mountSidebar = async (initialRouteName: string, collapsed = false) => {
  const router = createRouter({ history: createMemoryHistory(), routes });
  router.push({ name: initialRouteName });
  await router.isReady();
  return mount(SuperAdminSidebar, { props: { collapsed }, global: { plugins: [router] } });
};

describe("SuperAdminSidebar", () => {
  it("renders every group label when expanded", async () => {
    const wrapper = await mountSidebar("super-admin-home");
    expect(wrapper.text()).toContain("Organizations");
    expect(wrapper.text()).toContain("Inventory Data");
    expect(wrapper.text()).toContain("Monitoring");
    expect(wrapper.text()).toContain("Customers");
    expect(wrapper.text()).toContain("Platform");
  });

  it("hides group labels when collapsed", async () => {
    const wrapper = await mountSidebar("super-admin-home", true);
    expect(wrapper.text()).not.toContain("Organizations");
  });

  it("marks the current route's item active", async () => {
    const wrapper = await mountSidebar("super-admin-workspaces");
    const active = wrapper.find(".sa-item.active");
    expect(active.text()).toContain("Workspaces");
  });

  it("links Internal Ops to the internal-ops route", async () => {
    const wrapper = await mountSidebar("super-admin-home");
    const link = wrapper.findAll("a").find((a) => a.text().includes("Internal Ops"));
    expect(link?.attributes("href")).toBe("/internal");
  });
});
