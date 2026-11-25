import { ensureWorkspaceKeyRevoked, provisionAndActivateWorkspace, provisionWorkspaceKey, resolveLifecycleOrigin, revokeWorkspaceKey } from "./sgwLifecycle.ts";
import { handleRequest } from "../../../cloudflare/sgw/worker.mjs";

const workspace = "d8b57c2b-c473-451e-9d0b-a0989ac8a8a4";
const secret = "s".repeat(64);
const assert = (condition: boolean) => { if (!condition) throw new Error("assertion failed"); };

Deno.test("workspace activation only occurs after provisioning succeeds", async () => {
  const events: string[] = [];
  await provisionAndActivateWorkspace(async () => { events.push("provision"); }, async () => { events.push("initialize"); }, async () => { events.push("activate"); });
  assert(events.join(",") === "provision,initialize,activate");
  events.length = 0;
  let failed = false;
  try { await provisionAndActivateWorkspace(async () => { events.push("provision"); throw new Error("down"); }, async () => { events.push("initialize"); }, async () => { events.push("activate"); }); } catch { failed = true; }
  assert(failed && events.join(",") === "provision");
  events.length = 0; failed = false;
  try { await provisionAndActivateWorkspace(async () => { events.push("provision"); }, async () => { events.push("initialize"); throw new Error("down"); }, async () => { events.push("activate"); }); } catch { failed = true; }
  assert(failed && events.join(",") === "provision,initialize");
});

Deno.test("lifecycle local override only permits an explicit loopback origin", () => {
  assert(resolveLifecycleOrigin(undefined) === "https://sgw.itemtraxx.com");
  assert(resolveLifecycleOrigin("http://127.0.0.1:8788") === "http://127.0.0.1:8788");
  for (const value of ["http://example.com:8788", "https://127.0.0.1:8788", "http://127.0.0.1:8788/path", "http://127.0.0.1:8788/?x=1", "http://127.0.0.1:8788/#x"]) {
    let failed = false;
    try { resolveLifecycleOrigin(value); } catch { failed = true; }
    assert(failed);
  }
});

Deno.test("lifecycle selects the gateway for the configured project", () => {
  assert(resolveLifecycleOrigin(undefined, "https://nwuhjxicaopkmqydjlas.supabase.co") === "https://itemtraxx-sgw-staging.itemtraxx-co.workers.dev");
  assert(resolveLifecycleOrigin(undefined, "https://mlaspkufocikfcbjgpof.supabase.co") === "https://sgw.itemtraxx.com");
  let failed = false;
  try { resolveLifecycleOrigin(undefined, "https://unknown.supabase.co"); } catch { failed = true; }
  assert(failed);
});

Deno.test("purge revokes active and revoking keys and blocks uncertain state", async () => {
  for (const state of ["active", "revoking"]) {
    let revoked = false;
    await ensureWorkspaceKeyRevoked(state, async () => { revoked = true; });
    assert(revoked);
  }
  for (const state of ["provisioning", null] as const) {
    let failed = false;
    try { await ensureWorkspaceKeyRevoked(state, async () => {}); } catch { failed = true; }
    assert(failed);
  }
  await ensureWorkspaceKeyRevoked("revoked", async () => { throw new Error("unexpected"); });
});

Deno.test("revocation accepts only a confirmed revoked response", async () => {
  let observed = false;
  await revokeWorkspaceKey(workspace, secret, async (input) => {
    assert(input === "https://sgw.itemtraxx.com/v1/kms/revoke-tenant-keys");
    observed = true;
    return Response.json({ status: "revoked" });
  });
  assert(observed);
  let failed = false;
  try { await revokeWorkspaceKey(workspace, secret, async () => Response.json({ status: "active" })); } catch { failed = true; }
  assert(failed);
});

Deno.test("provisions using the fixed gateway and accepts only an active confirmation", async () => {
  let observed = false;
  await provisionWorkspaceKey(workspace, secret, async (input, options) => {
    assert(input === "https://sgw.itemtraxx.com/v1/kms/generate-tenant-keys");
    assert(options?.method === "POST" && options?.redirect === "error");
    assert((options?.headers as Record<string, string>).authorization === `Bearer ${secret}`);
    assert(options?.body === JSON.stringify({ workspace_id: workspace }));
    observed = true;
    return new Response(JSON.stringify({ status: "active" }), { status: 200 });
  });
  assert(observed);
});

Deno.test("fails closed for unavailable, ambiguous, or malformed gateway replies", async () => {
  for (const reply of [new Response("{}", { status: 200 }), new Response("{}", { status: 409 }), new Response("not json", { status: 200 })]) {
    let failed = false;
    try { await provisionWorkspaceKey(workspace, secret, async () => reply); } catch { failed = true; }
    assert(failed);
  }
  let sent = false;
  try { await provisionWorkspaceKey(workspace, "short", async () => { sent = true; return new Response(); }); } catch { /* expected */ }
  assert(!sent);
});

Deno.test("provisioning reaches the real gateway handler and stores wrapped keys", async () => {
  const values = new Map<string, string>();
  let state = "";
  const gatewayEnv = {
    KMS_LIFECYCLE_SECRET: secret,
    SGW_PROVISIONING_ENABLED: "true",
    MASTER_KEK: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
    KEYS: {
      get: (key: string) => Promise.resolve(values.get(key) ?? null),
      put: (key: string, value: string) => { values.set(key, value); return Promise.resolve(); },
    },
  };
  const transition = async (action: string) => {
    if (action === "claim_provision" && !state) { state = "provisioning"; return true; }
    if (action === "finish_provision" && state === "provisioning") { state = "active"; return true; }
    return false;
  };
  await provisionWorkspaceKey(workspace, secret, (input, init) => handleRequest(new Request(input, init), gatewayEnv, transition));
  assert(state === "active");
  const wrapped = JSON.parse(values.get(workspace) ?? "null");
  assert(typeof wrapped?.wrapped_dek?.ciphertext === "string");
  assert(typeof wrapped?.wrapped_pepper?.ciphertext === "string");
});
