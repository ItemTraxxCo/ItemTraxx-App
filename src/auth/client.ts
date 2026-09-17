import { createAuthClient } from "better-auth/client";
import { adminClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";
import { dashClient } from "@better-auth/infra/client";
import { globalAccess, globalRoles, organizationAccess, organizationRoles } from "./permissions";
import { fetchWithTransientRetry } from "../services/fetchWithTransientRetry";

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const configuredOrigin = (import.meta.env.VITE_EDGE_PROXY_URL as string | undefined)?.trim();
const baseURL = configuredOrigin ? trimTrailingSlash(configuredOrigin) : window.location.origin;

// Session reads are idempotent and a Cloudflare managed challenge is exposed
// to browser JavaScript as a rejected CORS fetch. Retry that transport once so
// a transient challenge does not make a valid login look unauthenticated.
const authFetch = (input: string | URL | Request, init?: RequestInit) =>
  fetchWithTransientRetry(input, init);

export const authClient = createAuthClient({
  baseURL,
  basePath: "/api/auth",
  fetchOptions: { credentials: "include", customFetchImpl: authFetch },
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
