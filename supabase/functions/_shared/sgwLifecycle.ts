export function resolveLifecycleOrigin(localOrigin: string | undefined, projectUrl?: string): string {
  if (!localOrigin) {
    if (!projectUrl || projectUrl === "https://mlaspkufocikfcbjgpof.supabase.co") return "https://sgw.itemtraxx.com";
    if (projectUrl === "https://nwuhjxicaopkmqydjlas.supabase.co") return "https://itemtraxx-sgw-staging.itemtraxx-co.workers.dev";
    throw new Error("Workspace key provisioning unavailable");
  }
  try {
    const url = new URL(localOrigin);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.href !== `${url.origin}/`) throw new Error();
    return url.origin;
  } catch {
    throw new Error("Workspace key provisioning unavailable");
  }
}

async function lifecycle(operation: "generate-tenant-keys" | "revoke-tenant-keys", expected: "active" | "revoked", workspaceId: string, secret: string, fetcher: typeof fetch): Promise<void> {
  if (secret.length < 32 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) {
    throw new Error("Workspace key provisioning unavailable");
  }
  try {
    const origin = resolveLifecycleOrigin(Deno.env.get("ITX_SGW_LOCAL_ORIGIN"), Deno.env.get("SUPABASE_URL"));
    const response = await fetcher(`${origin}/v1/kms/${operation}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId }),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || (await response.json())?.status !== expected) throw new Error();
  } catch {
    throw new Error("Workspace key provisioning unavailable");
  }
}

export const provisionWorkspaceKey = (workspaceId: string, secret: string, fetcher: typeof fetch = fetch) =>
  lifecycle("generate-tenant-keys", "active", workspaceId, secret, fetcher);

export const revokeWorkspaceKey = (workspaceId: string, secret: string, fetcher: typeof fetch = fetch) =>
  lifecycle("revoke-tenant-keys", "revoked", workspaceId, secret, fetcher);

export async function provisionAndActivateWorkspace(provision: () => Promise<void>, initialize: () => Promise<void>, activate: () => Promise<void>): Promise<void> {
  await provision();
  await initialize();
  await activate();
}

export async function ensureWorkspaceKeyRevoked(state: string | null, revoke: () => Promise<void>): Promise<void> {
  if (state === "revoked") return;
  if (state === "active" || state === "revoking") return await revoke();
  throw new Error("Workspace key revocation requires reconciliation");
}
