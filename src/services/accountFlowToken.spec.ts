import { afterEach, describe, expect, it } from "vitest";
import {
  captureAccountFlowTokenFromLocation,
  takeAccountEmailChangeToken,
  takeWorkspaceInvitationToken,
} from "./accountFlowToken";

const validToken = "a".repeat(64);

afterEach(() => {
  // Consume any in-memory token and restore a clean URL between cases.
  takeWorkspaceInvitationToken();
  takeAccountEmailChangeToken();
  window.history.replaceState(window.history.state, document.title, "/");
});

describe("account flow bearer token startup handling", () => {
  it("captures an invitation token before removing its fragment", () => {
    window.history.replaceState(
      window.history.state,
      document.title,
      `/accept-invitation?source=email#token=${validToken}`,
    );

    captureAccountFlowTokenFromLocation();

    expect(window.location.pathname).toBe("/accept-invitation");
    expect(window.location.search).toBe("?source=email");
    expect(window.location.hash).toBe("");
    expect(takeWorkspaceInvitationToken()).toBe(validToken);
    expect(takeWorkspaceInvitationToken()).toBe("");
  });

  it("captures an email-change step and token before removing its fragment", () => {
    window.history.replaceState(
      window.history.state,
      document.title,
      `/account/email-change#step=approve&token=${validToken}`,
    );

    captureAccountFlowTokenFromLocation();

    expect(window.location.pathname).toBe("/account/email-change");
    expect(window.location.hash).toBe("");
    expect(takeAccountEmailChangeToken()).toEqual({ step: "approve", token: validToken });
    expect(takeAccountEmailChangeToken()).toBeNull();
  });

  it("removes malformed flow fragments without accepting their contents", () => {
    window.history.replaceState(
      window.history.state,
      document.title,
      "/accept-invitation#token=not-a-valid-token",
    );

    captureAccountFlowTokenFromLocation();

    expect(window.location.hash).toBe("");
    expect(takeWorkspaceInvitationToken()).toBe("");
  });

  it("preserves tokens through the www-to-apex redirect, then captures them", () => {
    const replaceState = () => {};
    const aliasTarget = {
      location: {
        hostname: "www.itemtraxx.com",
        pathname: "/accept-invitation",
        search: "",
        hash: `#token=${validToken}`,
      },
      history: { state: null, replaceState },
      document: { title: "" },
    };
    captureAccountFlowTokenFromLocation(aliasTarget);
    expect(takeWorkspaceInvitationToken()).toBe("");

    const canonicalTarget = {
      ...aliasTarget,
      location: { ...aliasTarget.location, hostname: "itemtraxx.com" },
    };
    captureAccountFlowTokenFromLocation(canonicalTarget);
    expect(takeWorkspaceInvitationToken()).toBe(validToken);
  });

  it("leaves ordinary route fragments alone", () => {
    window.history.replaceState(window.history.state, document.title, "/login#sso");

    captureAccountFlowTokenFromLocation();

    expect(window.location.pathname).toBe("/login");
    expect(window.location.hash).toBe("#sso");
  });
});
