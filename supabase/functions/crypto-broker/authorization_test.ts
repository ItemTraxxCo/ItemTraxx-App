import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createBrokerHandler } from './handler.ts';

const workspace = 'd8b57c2b-c473-451e-9d0b-a0989ac8a8a4';
const otherWorkspace = 'fe2c2477-e6aa-462b-ab3c-502ba53bcba3';
const id = 'e535bd49-df6a-4c94-8e77-f9497ab83e43';

function setup(options: { role?: string; valid?: boolean; missing?: boolean; rowWorkspace?: string; gatewayFailure?: boolean; nameOnly?: boolean; realGateway?: (op: string, body: Record<string, unknown>) => Promise<Record<string, unknown>> } = {}) {
  let gatewayCalls = 0;
  let createArgs: Record<string, unknown> | undefined;
  let restoreCalls = 0;
  const query = (table: string) => {
    const filters: Record<string, unknown> = {};
    return {
      select() { return this; },
      eq(column: string, value: unknown) { filters[column] = value; return this; },
      is() { return this; },
      not() { return this; },
      maybeSingle() { const matching = filters.workspace_id === (options.rowWorkspace ?? workspace); return Promise.resolve({ data: matching ? { id, access_mode: 'all', encrypted_data: 'cipher', nonce: 'nonce', auth_tag: 'tag', key_version: 1 } : null, error: null }); },
      single() {
        if (table === 'profiles') return Promise.resolve({ data: { workspace_id: workspace, role: options.role ?? 'workspace_admin', is_active: true }, error: null });
        return Promise.resolve({ data: { status: 'active' }, error: null });
      },
      order() { return this; },
      range() { return this.in(); },
      in() {
        const matching = filters.workspace_id === (options.rowWorkspace ?? workspace);
        return Promise.resolve({ data: matching ? [{ id, encrypted_data: 'cipher', nonce: 'nonce', auth_tag: 'tag', key_version: 1 }] : [], error: null });
      },
    };
  };
  const client = { from: query, rpc: (name: string, args: Record<string, unknown>) => { if (name === 'restore_encrypted_borrower') { restoreCalls++; return Promise.resolve({ data: true, error: null }); } if (name === 'create_encrypted_borrower') { createArgs = args; return Promise.resolve({ data: args.p_id, error: null }); } return Promise.resolve({ data: [{ allowed: true, retry_after_seconds: null }], error: null }); } };
  const handler = createBrokerHandler({
    createClient: () => client as never,
    getExternalAuthUser: async () => ({ data: { user: { id } }, error: null }) as never,
    validateAccountDeviceSession: async () => ({ valid: options.valid ?? true, relationMissing: options.missing ?? false }) as never,
    requireTrustedEdgeIngress: async () => null,
    isKillSwitchWriteBlocked: () => false,
    getEnv: (name: string) => ({ ITX_SUPABASE_URL: 'https://example.supabase.co', ITX_PUBLISHABLE_KEY: 'public', ITX_SECRET_KEY: 'service', ITX_SGW_INTERNAL_SECRET: 's'.repeat(32) } as Record<string, string>)[name],
    callGateway: async (_op: unknown, body: Record<string, unknown>) => {
      gatewayCalls++;
      assertEquals(body.workspace_id, workspace);
      if (options.gatewayFailure) throw new Error('secret and plaintext must never be returned');
      if (options.realGateway) return await options.realGateway(String(_op), body);
      if (_op === 'encrypt') return { ciphertext: 'cipher', nonce: 'nonce', auth_tag: 'tag', borrower_id_hash: 'a'.repeat(64), borrower_email_hash: 'b'.repeat(64) };
      return { items: [{ id, payload: options.nameOnly ? { first_name: 'Ada', last_name: 'Lovelace', borrower_id: '123' } : { username: 'Alice', borrower_id: '123' } }] };
    },
  } as never);
  const run = (body: Record<string, unknown> = { action: 'decrypt', ids: [id] }) => handler(new Request('https://example.com/functions/crypto-broker', { method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: JSON.stringify({ ...body, device_id: 'device', workspace_id: otherWorkspace }) }));
  return { run, getGatewayCalls: () => gatewayCalls, getCreateArgs: () => createArgs, getRestoreCalls: () => restoreCalls };
}

Deno.test('broker authorizes an active admin and uses the profile workspace', async () => {
  const t = setup(); const response = await t.run();
  assertEquals(response.status, 200); assertEquals(t.getGatewayCalls(), 1);
});
Deno.test('broker denies another workspace borrower without decrypting', async () => {
  const t = setup({ rowWorkspace: otherWorkspace }); const response = await t.run();
  assertEquals(response.status, 404); assertEquals(t.getGatewayCalls(), 0);
});
Deno.test('broker denies tenant users, revoked sessions and unavailable session controls', async () => {
  for (const [options, status] of [[{ role: 'tenant_account' }, 403], [{ valid: false }, 401], [{ missing: true }, 503]] as const) {
    const t = setup(options); assertEquals((await t.run()).status, status); assertEquals(t.getGatewayCalls(), 0);
  }
});
Deno.test('broker fails closed if SGW is unavailable', async () => {
  const t = setup({ gatewayFailure: true }); const response = await t.run();
  assertEquals(response.status, 503); assertEquals((await response.text()).includes('plaintext'), false);
});

Deno.test('directory decrypts only a bounded page in the authenticated workspace', async () => {
  const t = setup();
  const response = await t.run({ action: 'list', page: 0, page_size: 50 });
  assertEquals(response.status, 200);
  const result = await response.json();
  assertEquals(result.data.rows[0].username, 'Alice');
  assertEquals(result.data.rows[0].workspace_id, workspace);
  assertEquals((await t.run({ action: 'list', page: 0, page_size: 101 })).status, 400);
});

Deno.test('directory accepts first and last names without a synthetic username', async () => {
  const t = setup({ nameOnly: true });
  const response = await t.run({ action: 'list', page: 0, page_size: 50 });
  assertEquals(response.status, 200);
  const result = await response.json();
  assertEquals(result.data.rows[0].display_name, 'Ada Lovelace');
  assertEquals(result.data.rows[0].first_name, 'Ada');
});

Deno.test('creation sends names and email only to encryption, never the database RPC', async () => {
  const t = setup();
  const response = await t.run({ action: 'create', payload: { first_name: 'Ada', last_name: 'Lovelace', borrower_id: 'ID123', email: 'ada@example.test', access_mode: 'all', profile_ids: [] } });
  assertEquals(response.status, 200);
  const stored = JSON.stringify(t.getCreateArgs());
  assertEquals(stored.includes('Ada'), false);
  assertEquals(stored.includes('ID123'), false);
  assertEquals(stored.includes('ada@example.test'), false);
});

Deno.test('encrypted creation rejects invalid identity, tenant role and unavailable gateway', async () => {
  const payload = { first_name: 'Ada', last_name: null, borrower_id: 'ABC123', email: null, access_mode: 'all', profile_ids: [] };
  for (const [options, input, expected] of [
    [{ role: 'tenant_account' }, payload, 403],
    [{}, { ...payload, first_name: '  ' }, 400],
    [{}, { ...payload, borrower_id: 'A-1' }, 400],
    [{ gatewayFailure: true }, payload, 503],
  ] as const) {
    const t = setup(options);
    assertEquals((await t.run({ action: 'create', payload: input })).status, expected);
    assertEquals(t.getCreateArgs(), undefined);
  }
});

Deno.test('named creation reaches the real local SGW and sends only ciphertext to the DB boundary', async () => {
  const { generateWorkspaceKeys } = await import('../../../cloudflare/sgw/crypto.mjs');
  const { handleRequest } = await import('../../../cloudflare/sgw/worker.mjs');
  const key = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await generateWorkspaceKeys(key, workspace);
  const secret = 's'.repeat(32);
  const env = { MASTER_KEK: btoa(String.fromCharCode(...key)), KMS_INTERNAL_SECRET: secret, KEYS: { get: async () => JSON.stringify(wrapped) } };
  const gateway = async (op: string, body: Record<string, unknown>) => {
    const response = await handleRequest(new Request('https://sgw.itemtraxx.com/v1/crypto/' + op, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, async () => true);
    if (!response.ok) throw new Error('SGW failed');
    return await response.json();
  };
  const t = setup({ realGateway: gateway });
  const result = await t.run({ action: 'create', payload: { first_name: 'Ada', last_name: 'Lovelace', borrower_id: 'ABC123', email: 'ada@example.test', access_mode: 'all', profile_ids: [] } });
  assertEquals(result.status, 200);
  const args = t.getCreateArgs()!;
  const saved = JSON.stringify(args);
  assertEquals(saved.includes('Ada'), false);
  assertEquals(saved.includes('ABC123'), false);
  const decrypted: any = await gateway('decrypt', { workspace_id: workspace, items: [{ id: args.p_id, ciphertext: args.p_encrypted_data, nonce: args.p_nonce, auth_tag: args.p_auth_tag }] });
  assertEquals(decrypted.items[0].payload, { first_name: 'Ada', last_name: 'Lovelace', borrower_id: 'ABC123', email: 'ada@example.test' });
});

Deno.test('archived records use the broker and decrypt before restore', async () => {
  const t = setup({ nameOnly: true });
  const list = await t.run({ action: 'list', archived: true, page: 0, page_size: 50 });
  assertEquals(list.status, 200);
  assertEquals((await list.json()).data.rows[0].display_name, 'Ada Lovelace');
  const restore = await t.run({ action: 'restore', id });
  assertEquals(restore.status, 200);
  assertEquals((await restore.json()).data.display_name, 'Ada Lovelace');
  assertEquals(t.getRestoreCalls(), 1);
});
Deno.test('restore fails closed when decryption fails or the row is outside the workspace', async () => {
  for (const options of [{ gatewayFailure: true }, { rowWorkspace: otherWorkspace }]) {
    const t = setup(options);
    const response = await t.run({ action: 'restore', id });
    assertEquals(response.status === 503 || response.status === 404, true);
    assertEquals(t.getRestoreCalls(), 0);
  }
});
