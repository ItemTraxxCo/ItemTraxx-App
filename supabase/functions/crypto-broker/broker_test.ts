import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { callGateway } from './gateway.ts';

Deno.test('gateway uses fixed trusted endpoint and never forwards upstream error text', async () => {
  let observed = '';
  const fakeFetch = (input: string | URL | Request, init?: RequestInit) => {
    observed = String(input);
    assertEquals(new Headers(init?.headers).get('authorization'), `Bearer ${'s'.repeat(32)}`);
    return Promise.resolve(new Response('sensitive upstream error', { status: 500 }));
  };
  await assertRejects(() => callGateway('encrypt', { workspace_id: 'a' }, 's'.repeat(32), fakeFetch), Error, 'Gateway unavailable');
  assertEquals(observed, 'https://sgw.itemtraxx.com/v1/crypto/encrypt');
});
Deno.test('gateway rejects redirects and non-object responses', async () => {
  const fakeFetch = (_input: string | URL | Request, init?: RequestInit) => {
    assertEquals(init?.redirect, 'error');
    return Promise.resolve(new Response('[]'));
  };
  await assertRejects(() => callGateway('decrypt', {}, 's'.repeat(32), fakeFetch), Error, 'Gateway unavailable');
});

Deno.test('broker gateway interoperates with the local SGW and binds workspace and record', async () => {
  const { handleRequest } = await import('../../../cloudflare/sgw/worker.mjs');
  const { generateWorkspaceKeys } = await import('../../../cloudflare/sgw/crypto.mjs');
  const workspace = 'd8b57c2b-c473-451e-9d0b-a0989ac8a8a4';
  const id = 'e535bd49-df6a-4c94-8e77-f9497ab83e43';
  const kek = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await generateWorkspaceKeys(kek, workspace);
  const secret = 's'.repeat(32);
  const env = { MASTER_KEK: btoa(String.fromCharCode(...kek)), KMS_INTERNAL_SECRET: secret, KEYS: { get: async (key: string) => key === workspace ? JSON.stringify(wrapped) : null } };
  const fakeFetch = (input: string | URL | Request, init?: RequestInit) => handleRequest(new Request(input, init), env, async () => true);
  const encrypted = await callGateway('encrypt', { workspace_id: workspace, id, payload: { borrower_id: 'AbC', name: 'Alice' }, index_fields: { borrower_id: 'AbC' } }, secret, fakeFetch);
  const decrypted = await callGateway('decrypt', { workspace_id: workspace, items: [{ id, ...encrypted }] }, secret, fakeFetch);
  assertEquals(decrypted, { items: [{ id, payload: { borrower_id: 'AbC', name: 'Alice' } }] });
  const hashed = await callGateway('hash-index', { workspace_id: workspace, values: { borrower_id: ' abc ' } }, secret, fakeFetch);
  assertEquals(hashed.borrower_id_hash, encrypted.borrower_id_hash);
  await assertRejects(() => callGateway('decrypt', { workspace_id: crypto.randomUUID(), items: [{ id, ...encrypted }] }, secret, fakeFetch), Error, 'Gateway unavailable');
});

Deno.test('local gateway override accepts only loopback and never changes production default', async () => {
  const { resolveGatewayOrigin } = await import('./gateway.ts');
  assertEquals(resolveGatewayOrigin(undefined), 'https://sgw.itemtraxx.com');
  assertEquals(resolveGatewayOrigin('http://127.0.0.1:8788'), 'http://127.0.0.1:8788');
  for (const invalid of ['http://evil.example', 'http://127.0.0.1.evil.test:8788', 'https://127.0.0.1:8788', 'http://127.0.0.1:8788/path', 'http://user:pass@127.0.0.1:8788']) {
    await assertRejects(async () => resolveGatewayOrigin(invalid), Error, 'Gateway unavailable');
  }
});

Deno.test('gateway selects the isolated staging endpoint only for the staging project', async () => {
  const { resolveGatewayOrigin } = await import('./gateway.ts');
  assertEquals(resolveGatewayOrigin(undefined, 'https://nwuhjxicaopkmqydjlas.supabase.co'), 'https://itemtraxx-sgw-staging.itemtraxx-co.workers.dev');
  assertEquals(resolveGatewayOrigin(undefined, 'https://mlaspkufocikfcbjgpof.supabase.co'), 'https://sgw.itemtraxx.com');
  await assertRejects(async () => resolveGatewayOrigin(undefined, 'https://unknown.supabase.co'), Error, 'Gateway unavailable');
});
