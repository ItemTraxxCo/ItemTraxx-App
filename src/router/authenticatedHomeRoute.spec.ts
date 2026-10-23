import { describe, expect, it } from "vitest";
import { resolveAuthenticatedHomeRoute } from "./authenticatedHomeRoute";

describe("resolveAuthenticatedHomeRoute", () => {
  it("forwards a callback proof through the authenticated home redirect", () => {
    const proof = "signed-callback-proof";
    const route = {
      name: "public-home",
      query: { itx_sso_proof: proof },
    } as never;
    const auth = {
      isInitialized: true,
      isAuthenticated: true,
      role: "workspace_admin",
      workspaceContextId: "workspace-1",
    } as never;

    expect(resolveAuthenticatedHomeRoute(route, auth)).toEqual({
      name: "workspace-admin-home",
      query: { itx_sso_proof: proof },
    });
  });

  it("does not forward legacy unverified SSO labels", () => {
    const route = {
      name: "public-home",
      query: {
        itx_sso_provider_id: "invented-provider",
        itx_sso_protocol: "SAML2.0",
      },
    } as never;
    const auth = {
      isInitialized: true,
      isAuthenticated: true,
      role: "workspace_admin",
      workspaceContextId: "workspace-1",
    } as never;

    expect(resolveAuthenticatedHomeRoute(route, auth)).toEqual({
      name: "workspace-admin-home",
    });
  });
});
