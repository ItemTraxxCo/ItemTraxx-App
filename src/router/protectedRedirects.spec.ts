import { beforeEach, describe, expect, it } from "vitest";
import router from "./index";
import {
  clearAuthState,
  setAuthStateFromBackend,
} from "../store/authState";
import {
  clearWorkspaceState,
  setWorkspaceState,
} from "../store/workspaceState";

const setTenantSession = (workspaceId = "workspace-1") => {
  setAuthStateFromBackend({
    isInitialized: true,
    isAuthenticated: true,
    userId: "user-1",
    email: "tenant@example.com",
    signedInAt: new Date().toISOString(),
    role: "tenant_account",
    sessionWorkspaceId: workspaceId,
    workspaceContextId: workspaceId,
  });
};

const setIndividualSession = (minutesOld = 16) => {
  const signedInAt = new Date(Date.now() - minutesOld * 60 * 1000).toISOString();
  setAuthStateFromBackend({
    isInitialized: true,
    isAuthenticated: true,
    userId: "individual-1",
    email: "individual@example.com",
    signedInAt,
    role: "individual_account",
    sessionWorkspaceId: "workspace-1",
    workspaceContextId: "workspace-1",
    adminVerifiedAt: signedInAt,
  });
};

describe("protected route redirects", () => {
  beforeEach(async () => {
    clearAuthState(true);
    clearWorkspaceState();
    await router.replace("/");
  });

  it("sends a signed-out visitor to login with the requested path", async () => {
    await router.push("/checkout?source=email");

    expect(router.currentRoute.value.name).toBe("public-login");
    expect(router.currentRoute.value.query).toEqual({
      redirect: "/checkout?source=email",
    });
  });

  it("keeps an authenticated account on an allowed workspace route", async () => {
    setTenantSession();

    await router.push("/checkout");

    expect(router.currentRoute.value.name).toBe("workspace-checkout");
  });

  it("keeps an individual account on checkout after admin verification expires", async () => {
    setIndividualSession();

    await router.push("/checkout");

    expect(router.currentRoute.value.name).toBe("workspace-checkout");
  });

  it("routes an individual account from the public home page to checkout after verification expires", async () => {
    setIndividualSession();

    await router.push("/");

    expect(router.currentRoute.value.name).toBe("workspace-checkout");
  });

  it("still requires fresh verification for other individual-account routes", async () => {
    setIndividualSession();

    await router.push("/account");

    expect(router.currentRoute.value.name).toBe("public-login");
  });

  it("denies workspace admins access to checkout", async () => {
    setAuthStateFromBackend({
      isInitialized: true,
      isAuthenticated: true,
      userId: "admin-1",
      email: "admin@example.com",
      signedInAt: new Date().toISOString(),
      role: "workspace_admin",
      sessionWorkspaceId: "workspace-1",
      workspaceContextId: "workspace-1",
    });

    await router.push("/checkout");

    expect(router.currentRoute.value.name).toBe("public-access-denied");
    expect(router.currentRoute.value.query).toEqual({ redirect: "/checkout" });
  });

  it("sends a signed-out visitor on a known workspace host to login", async () => {
    setWorkspaceState({
      host: "itxdemo.app.itemtraxx.com",
      slug: "itxdemo",
      isWorkspaceHost: true,
      baseHost: "app.itemtraxx.com",
      workspaceId: "workspace-1",
      workspaceName: "ITX Demo",
      isKnownWorkspace: true,
    });

    await router.push("/checkout");

    expect(router.currentRoute.value.name).toBe("public-login");
    expect(router.currentRoute.value.query).toEqual({ redirect: "/checkout" });
  });

  it("shows access denied when the current workspace host does not match the account", async () => {
    setTenantSession("workspace-2");
    setWorkspaceState({
      host: "itxdemo.app.itemtraxx.com",
      slug: "itxdemo",
      isWorkspaceHost: true,
      baseHost: "app.itemtraxx.com",
      workspaceId: "workspace-1",
      workspaceName: "ITX Demo",
      isKnownWorkspace: true,
    });

    await router.push("/checkout");

    expect(router.currentRoute.value.name).toBe("public-access-denied");
    expect(router.currentRoute.value.query).toEqual({ redirect: "/checkout" });
  });

  it("shows access denied when the signed-in role cannot use a route", async () => {
    setTenantSession();

    await router.push("/admin");

    expect(router.currentRoute.value.name).toBe("public-access-denied");
    expect(router.currentRoute.value.query).toEqual({ redirect: "/admin" });
  });

  it("keeps an unknown workspace host as a 404", async () => {
    setWorkspaceState({
      host: "unknown.app.itemtraxx.com",
      slug: "unknown",
      isWorkspaceHost: true,
      baseHost: "app.itemtraxx.com",
      workspaceId: null,
      workspaceName: null,
      isKnownWorkspace: false,
    });

    await router.push("/checkout");

    expect(router.currentRoute.value.name).toBe("not-found");
  });
});
