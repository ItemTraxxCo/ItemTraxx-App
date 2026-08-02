import { describe, expect, it } from "vitest";
import { createRouter, createMemoryHistory } from "vue-router";
import { isPublicBootstrapRoute } from "./routeBootstrap";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", name: "home", component: { template: "<div/>" }, meta: { public: true } },
    { path: "/checkout", name: "checkout", component: { template: "<div/>" }, meta: {} },
    { path: "/admin", name: "admin", component: { template: "<div/>" } },
  ],
});

describe("isPublicBootstrapRoute", () => {
  it("returns true for a route marked public in its meta", () => {
    expect(isPublicBootstrapRoute(router, "/")).toBe(true);
  });

  it("returns false for a route with meta.public explicitly false/absent", () => {
    expect(isPublicBootstrapRoute(router, "/checkout")).toBe(false);
  });

  it("returns false for a route with no meta at all", () => {
    expect(isPublicBootstrapRoute(router, "/admin")).toBe(false);
  });

  it("defaults an empty path to '/'", () => {
    expect(isPublicBootstrapRoute(router, "")).toBe(true);
  });
});
