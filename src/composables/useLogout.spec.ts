import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { useLogout } from "./useLogout";

vi.mock("../services/authService", () => ({
  getPostSignOutUrl: vi.fn(() => "/login"),
  signOut: vi.fn(async () => ({ ok: true })),
}));

const mountLogout = async (): Promise<{ logout: () => Promise<boolean>; router: Router }> => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "root", component: { template: "<div />" } },
      { path: "/login", name: "login", component: { template: "<div />" } },
    ],
  });
  // No router.isReady() here on purpose: with createMemoryHistory() it never resolves
  // unless an initial navigation is triggered, and this test only needs router.push().
  let logout!: () => Promise<boolean>;
  mount(
    {
      setup() {
        logout = useLogout().logout;
        return () => null;
      },
    },
    { global: { plugins: [router] } },
  );
  return { logout, router };
};

describe("useLogout", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing and reports not-confirmed if the confirm dialog is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { logout } = await mountLogout();
    const authService = await import("../services/authService");
    const confirmed = await logout();
    expect(authService.signOut).not.toHaveBeenCalled();
    expect(confirmed).toBe(false);
  });

  it("signs out, redirects to a relative post-sign-out URL via the router, and reports confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { logout, router } = await mountLogout();
    const pushSpy = vi.spyOn(router, "push");
    const confirmed = await logout();
    expect(pushSpy).toHaveBeenCalledWith("/login");
    expect(confirmed).toBe(true);
  });

  it("alerts and does not redirect when sign-out fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const authService = await import("../services/authService");
    vi.mocked(authService.signOut).mockResolvedValueOnce({ ok: false } as Awaited<ReturnType<typeof authService.signOut>>);
    const { logout, router } = await mountLogout();
    const pushSpy = vi.spyOn(router, "push");
    await logout();
    expect(alertSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("assigns the browser location directly for an absolute post-sign-out URL, without using the router", async () => {
    // jsdom's window.location.assign is non-configurable, so vi.spyOn can't
    // touch it directly. Swap the whole location object out for one that
    // replaces assign with a spy, then restore the original afterward.
    const originalLocation = window.location;
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, assign },
    });
    try {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const authService = await import("../services/authService");
      vi.mocked(authService.getPostSignOutUrl).mockReturnValueOnce("https://itemtraxx.com/login");
      const { logout, router } = await mountLogout();
      const pushSpy = vi.spyOn(router, "push");
      await logout();
      expect(assign).toHaveBeenCalledWith("https://itemtraxx.com/login");
      expect(pushSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    }
  });
});
