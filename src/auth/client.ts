import { createAuthClient } from "better-auth/client";
import { adminClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import { dashClient } from "@better-auth/infra/client";
import { globalAccess, globalRoles, organizationAccess, organizationRoles } from "./permissions";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const configuredOrigin = (import.meta.env.VITE_EDGE_PROXY_URL as string | undefined)?.trim();
const baseURL = configuredOrigin ? trimTrailingSlash(configuredOrigin) : window.location.origin;

export const authClient = createAuthClient({
  baseURL,
  basePath: "/api/auth",
  fetchOptions: { credentials: "include" },
  plugins: [
    organizationClient({ ac: organizationAccess, roles: organizationRoles }),
    adminClient({ ac: globalAccess, roles: globalRoles }),
    passkeyClient(),
    twoFactorClient({
      onTwoFactorRedirect: () => window.location.assign("/login/two-factor"),
    }),
    ssoClient({ domainVerification: { enabled: true } }),
    dashClient(),
  ],
});
