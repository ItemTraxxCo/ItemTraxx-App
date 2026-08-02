import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();

vi.mock("./supabaseClient", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

vi.mock("../store/workspaceState", () => ({
  clearWorkspaceState: vi.fn(),
  setWorkspaceState: vi.fn(),
}));

import { clearWorkspaceState, setWorkspaceState } from "../store/workspaceState";
import {
  buildWorkspaceAppUrl,
  initializeWorkspaceContext,
  lookupWorkspaceById,
  lookupWorkspaceBySlug,
  resolveWorkspaceHost,
} from "./workspaceService";

beforeEach(() => {
  rpcMock.mockReset();
  vi.mocked(clearWorkspaceState).mockReset();
  vi.mocked(setWorkspaceState).mockReset();
});

describe("resolveWorkspaceHost", () => {
  it("treats the bare root domain as not a workspace host", () => {
    expect(resolveWorkspaceHost("itemtraxx.com")).toEqual({
      host: "itemtraxx.com",
      slug: null,
      isWorkspaceHost: false,
      baseHost: "itemtraxx.com",
    });
  });

  it("treats www and the bare app root as not a workspace host", () => {
    expect(resolveWorkspaceHost("www.itemtraxx.com").isWorkspaceHost).toBe(false);
    expect(resolveWorkspaceHost("app.itemtraxx.com").isWorkspaceHost).toBe(false);
  });

  it("treats localhost as not a workspace host", () => {
    expect(resolveWorkspaceHost("localhost")).toEqual({
      host: "localhost",
      slug: null,
      isWorkspaceHost: false,
      baseHost: "localhost",
    });
  });

  it("extracts and normalizes the slug from a workspace subdomain", () => {
    expect(resolveWorkspaceHost("Acme-High.app.itemtraxx.com")).toEqual({
      host: "acme-high.app.itemtraxx.com",
      slug: "acme-high",
      isWorkspaceHost: true,
      baseHost: "app.itemtraxx.com",
    });
  });

  it("treats reserved subdomains (www/internal/status/app) as not a workspace host", () => {
    const result = resolveWorkspaceHost("internal.app.itemtraxx.com");
    expect(result.isWorkspaceHost).toBe(false);
    expect(result.slug).toBeNull();
  });

  it("supports the .localhost dev suffix and maps baseHost back to localhost", () => {
    expect(resolveWorkspaceHost("acme.localhost")).toEqual({
      host: "acme.localhost",
      slug: "acme",
      isWorkspaceHost: true,
      baseHost: "localhost",
    });
  });

  it("returns no slug for an unrecognized host shape", () => {
    const result = resolveWorkspaceHost("example.org");
    expect(result).toEqual({ host: "example.org", slug: null, isWorkspaceHost: false, baseHost: "example.org" });
  });

  it("returns an empty state for an empty hostname", () => {
    expect(resolveWorkspaceHost("")).toEqual({ host: "", slug: null, isWorkspaceHost: false, baseHost: null });
  });
});

describe("buildWorkspaceAppUrl", () => {
  it("builds an https URL for the workspace subdomain with a leading-slash path", () => {
    expect(buildWorkspaceAppUrl("acme", "/dashboard")).toBe("https://acme.app.itemtraxx.com/dashboard");
  });

  it("adds a leading slash when the path is missing one", () => {
    expect(buildWorkspaceAppUrl("acme", "dashboard")).toBe("https://acme.app.itemtraxx.com/dashboard");
  });
});

describe("lookupWorkspaceBySlug / lookupWorkspaceById", () => {
  it("calls the resolve-by-slug RPC and returns the row when active", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ id: "ws-1", name: "Acme", slug: "acme", status: "active" }], error: null });

    const result = await lookupWorkspaceBySlug("acme");

    expect(rpcMock).toHaveBeenCalledWith("resolve_public_workspace_by_slug", { p_slug: "acme" });
    expect(result).toEqual({ id: "ws-1", name: "Acme", slug: "acme", status: "active" });
  });

  it("calls the resolve-by-id RPC", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ id: "ws-1", name: "Acme", slug: "acme", status: "active" }], error: null });

    await lookupWorkspaceById("ws-1");

    expect(rpcMock).toHaveBeenCalledWith("resolve_public_workspace_by_id", { p_id: "ws-1" });
  });

  it("returns null when the RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    expect(await lookupWorkspaceBySlug("acme")).toBeNull();
  });

  it("returns null when no row is found", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });

    expect(await lookupWorkspaceBySlug("acme")).toBeNull();
  });

  it("returns null for a suspended workspace", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ id: "ws-1", name: "Acme", slug: "acme", status: "suspended" }], error: null });

    expect(await lookupWorkspaceBySlug("acme")).toBeNull();
  });

  it("returns null for an archived workspace", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ id: "ws-1", name: "Acme", slug: "acme", status: "archived" }], error: null });

    expect(await lookupWorkspaceBySlug("acme")).toBeNull();
  });
});

describe("initializeWorkspaceContext", () => {
  const originalHostname = window.location.hostname;

  const setHostname = (hostname: string) => {
    Object.defineProperty(window, "location", {
      value: { ...window.location, hostname },
      writable: true,
      configurable: true,
    });
  };

  afterEach(() => {
    setHostname(originalHostname);
    delete document.documentElement.dataset.workspaceSlug;
  });

  it("clears workspace state when the hostname is empty", async () => {
    setHostname("");

    await initializeWorkspaceContext();

    expect(clearWorkspaceState).toHaveBeenCalledTimes(1);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sets the base workspace state and clears the slug dataset when not a workspace host", async () => {
    setHostname("itemtraxx.com");

    await initializeWorkspaceContext();

    expect(setWorkspaceState).toHaveBeenCalledWith(
      expect.objectContaining({ host: "itemtraxx.com", slug: null, isWorkspaceHost: false })
    );
    expect(document.documentElement.dataset.workspaceSlug).toBeUndefined();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("resolves the slug, sets the dataset attribute, and looks up the workspace", async () => {
    setHostname("acme.app.itemtraxx.com");
    rpcMock.mockResolvedValueOnce({ data: [{ id: "ws-1", name: "Acme", slug: "acme", status: "active" }], error: null });

    await initializeWorkspaceContext();

    expect(document.documentElement.dataset.workspaceSlug).toBe("acme");
    expect(rpcMock).toHaveBeenCalledWith("resolve_public_workspace_by_slug", { p_slug: "acme" });
    expect(setWorkspaceState).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      isKnownWorkspace: true,
    });
  });

  it("marks the workspace unknown when the slug does not resolve to any workspace", async () => {
    setHostname("unknown.app.itemtraxx.com");
    rpcMock.mockResolvedValueOnce({ data: [], error: null });

    await initializeWorkspaceContext();

    expect(setWorkspaceState).toHaveBeenCalledWith({
      workspaceId: null,
      workspaceName: null,
      isKnownWorkspace: false,
    });
  });

  it("is a no-op when window is undefined (SSR guard)", async () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error simulating an SSR environment
    delete globalThis.window;

    await expect(initializeWorkspaceContext()).resolves.toBeUndefined();

    globalThis.window = originalWindow;
  });
});
