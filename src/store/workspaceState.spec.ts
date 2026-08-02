import { afterEach, describe, expect, it } from "vitest";
import { clearWorkspaceState, getWorkspaceState, setWorkspaceState } from "./workspaceState";

afterEach(() => {
  clearWorkspaceState();
});

describe("workspaceState store", () => {
  it("starts with the default (empty) state", () => {
    expect(getWorkspaceState()).toEqual({
      host: null,
      slug: null,
      isWorkspaceHost: false,
      baseHost: null,
      workspaceId: null,
      workspaceName: null,
      isKnownWorkspace: false,
      hostMismatch: false,
    });
  });

  it("merges a partial update without touching unrelated fields", () => {
    setWorkspaceState({ workspaceId: "ws-1", workspaceName: "Acme" });
    setWorkspaceState({ isKnownWorkspace: true });

    const state = getWorkspaceState();
    expect(state.workspaceId).toBe("ws-1");
    expect(state.workspaceName).toBe("Acme");
    expect(state.isKnownWorkspace).toBe(true);
  });

  it("clearWorkspaceState resets every field back to its default", () => {
    setWorkspaceState({ workspaceId: "ws-1", hostMismatch: true, isWorkspaceHost: true });

    clearWorkspaceState();

    expect(getWorkspaceState()).toEqual({
      host: null,
      slug: null,
      isWorkspaceHost: false,
      baseHost: null,
      workspaceId: null,
      workspaceName: null,
      isKnownWorkspace: false,
      hostMismatch: false,
    });
  });
});
