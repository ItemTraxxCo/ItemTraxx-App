import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2';
import { getExternalAuthUser } from '../_shared/externalAuth.ts';
import { resolveCorsHeaders } from '../_shared/cors.ts';
import { requireTrustedEdgeIngress } from '../_shared/trustedIngress.ts';
import { validateAccountDeviceSession } from '../_shared/accountSessions.ts';
import { resolveWorkspaceAccess } from '../_shared/workspaceAccess.ts';
import { isKillSwitchWriteBlocked } from '../_shared/killSwitch.ts';
import { readJsonBody } from '../_shared/requestBody.ts';
import { asRecord, optionalText, requireText, requireUuid, ValidationError } from '../_shared/validation.ts';
import { resolveRateLimitResult } from '../_shared/preloginGuards.ts';
import { callGateway } from './gateway.ts';
import { borrowerEncryptionEnabled } from '../_shared/borrowerEncryptionMode.ts';

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

type Dependencies = {
  createClient: typeof createClient;
  getExternalAuthUser: typeof getExternalAuthUser;
  validateAccountDeviceSession: typeof validateAccountDeviceSession;
  requireTrustedEdgeIngress: typeof requireTrustedEdgeIngress;
  isKillSwitchWriteBlocked: typeof isKillSwitchWriteBlocked;
  callGateway: typeof callGateway;
  getEnv: (name: string) => string | undefined;
};

export function createBrokerHandler(overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = {
    createClient, getExternalAuthUser, validateAccountDeviceSession,
    requireTrustedEdgeIngress, isKillSwitchWriteBlocked, callGateway,
    getEnv: (name) => Deno.env.get(name), ...overrides,
  };
  return async (req: Request) => {
  const { originAllowed, headers } = resolveCorsHeaders(req, cors);
  const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
    status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (req.method === 'OPTIONS') return originAllowed ? new Response('ok', { headers }) : reply(403, { error: 'Origin not allowed' });
  if (req.headers.get('origin') && !originAllowed) return reply(403, { error: 'Origin not allowed' });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  const ingressError = await deps.requireTrustedEdgeIngress(req, 'crypto-broker', reply);
  if (ingressError) return ingressError;
  if (deps.isKillSwitchWriteBlocked(req)) return reply(503, { error: 'Service unavailable' });
  try {
    const auth = req.headers.get('authorization');
    const token = auth?.replace(/^Bearer\s+/i, '').trim() ?? '';
    const url = deps.getEnv('ITX_SUPABASE_URL') ?? deps.getEnv('SUPABASE_URL');
    const publicKey = deps.getEnv('ITX_PUBLISHABLE_KEY') ?? deps.getEnv('SUPABASE_ANON_KEY');
    const serviceKey = deps.getEnv('ITX_SECRET_KEY') ?? deps.getEnv('SUPABASE_SERVICE_ROLE_KEY');
    const gatewaySecret = deps.getEnv('ITX_SGW_INTERNAL_SECRET');
    if (!auth || !token) return reply(401, { error: 'Unauthorized' });
    if (!url || !publicKey || !serviceKey || !gatewaySecret || gatewaySecret.length < 32) return reply(503, { error: 'Service unavailable' });
    const user = deps.createClient(url, publicKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const admin = deps.createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: session, error: authError } = await deps.getExternalAuthUser(user, auth);
    if (authError || !session.user) return reply(401, { error: 'Unauthorized' });
    const { data: profile, error: profileError } = await user.from('profiles').select('workspace_id,role,is_active').eq('id', session.user.id).single();
    if (profileError || !profile?.workspace_id || profile.is_active === false || !['workspace_admin', 'individual_account', 'tenant_account'].includes(profile.role)) return reply(403, { error: 'Access denied' });
    const { data: workspace, error: workspaceError } = await user.from('workspaces').select('status').eq('id', profile.workspace_id).single();
    if (!resolveWorkspaceAccess(workspace, workspaceError).allowed) return reply(403, { error: 'Access denied' });
    const body = asRecord(await readJsonBody(req, 48 * 1024));
    const tenantDirectory = profile.role === 'tenant_account';
    if (tenantDirectory && (!['list', 'mode'].includes(String(body.action)) || body.archived === true)) return reply(403, { error: 'Access denied' });
    const deviceId = optionalText(body.device_id, { maxLen: 128 });
    const device = await deps.validateAccountDeviceSession(admin, { workspaceId: profile.workspace_id, profileId: session.user.id, deviceId, authToken: token });
    if (device.relationMissing) return reply(503, { error: 'Service unavailable' });
    if (!device.valid) return reply(401, { error: 'Session revoked' });
    const directory = body.action === 'list';
    const rate = await user.rpc('consume_rate_limit', { p_scope: directory ? (body.archived === true ? 'borrower_directory_archived' : 'borrower_directory') : 'admin', p_limit: directory ? 240 : 30, p_window_seconds: 60 });
    const { result: limit, response: failure } = resolveRateLimitResult({ data: rate.data, error: rate.error, jsonResponse: reply, failureStatus: 503 });
    if (failure) return failure;
    if (!limit?.allowed) return reply(429, { error: 'Rate limit exceeded', retry_after_seconds: limit?.retry_after_seconds ?? null });
    const workspaceId = profile.workspace_id;
    if (body.action === 'mode') {
      const enabled = await borrowerEncryptionEnabled(admin, workspaceId, deps.getEnv('ITX_ENCRYPTED_BORROWERS_LOCAL') === 'true');
      return reply(200, { data: { encrypted: enabled } });
    }
    if (body.action === 'create') {
      const enabled = await borrowerEncryptionEnabled(admin, workspaceId, deps.getEnv('ITX_ENCRYPTED_BORROWERS_LOCAL') === 'true');
      if (!enabled) return reply(503, { error: 'Borrower encryption is not ready for this workspace' });
      const input = asRecord(body.payload);
      const firstName = requireText(input.first_name, { maxLen: 100 });
      const lastName = optionalText(input.last_name, { maxLen: 100 });
      const borrowerId = requireText(input.borrower_id, { maxLen: 32, pattern: /^[a-z0-9]+$/i });
      const email = optionalText(input.email, { maxLen: 254 });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError();
      const mode = input.access_mode;
      if (mode !== 'all' && mode !== 'restricted') throw new ValidationError();
      if (!Array.isArray(input.profile_ids) || input.profile_ids.length > 100) throw new ValidationError();
      const profileIds = input.profile_ids.map(requireUuid);
      if (new Set(profileIds).size !== profileIds.length || (mode === 'restricted' && profileIds.length === 0) || (mode === 'all' && profileIds.length > 0)) throw new ValidationError();
      const id = crypto.randomUUID();
      const payload = { first_name: firstName, last_name: lastName || null, borrower_id: borrowerId, email: email || null };
      const encrypted = await deps.callGateway('encrypt', { workspace_id: workspaceId, id, payload, index_fields: { borrower_id: borrowerId, ...(email ? { email } : {}) } }, gatewaySecret);
      if (typeof encrypted.ciphertext !== 'string' || !encrypted.ciphertext || typeof encrypted.nonce !== 'string' || !encrypted.nonce || typeof encrypted.auth_tag !== 'string' || !encrypted.auth_tag || typeof encrypted.borrower_id_hash !== 'string' || !/^[a-f0-9]{64}$/.test(encrypted.borrower_id_hash) || (email && (typeof encrypted.borrower_email_hash !== 'string' || !/^[a-f0-9]{64}$/.test(encrypted.borrower_email_hash)))) throw new Error('Gateway unavailable');
      const { data, error } = await admin.rpc('create_encrypted_borrower', { p_id: id, p_workspace_id: workspaceId, p_actor_id: session.user.id, p_encrypted_data: encrypted.ciphertext, p_nonce: encrypted.nonce, p_auth_tag: encrypted.auth_tag, p_borrower_id_hash: encrypted.borrower_id_hash, p_borrower_email_hash: email ? encrypted.borrower_email_hash : null, p_access_mode: mode, p_profile_ids: profileIds });
      if (error || data !== id) return reply(error?.code === '23505' ? 409 : 503, { error: error?.code === '23505' ? 'Borrower ID already exists' : 'Unable to create borrower' });
      const displayName = [firstName, lastName].filter(Boolean).join(' ');
      return reply(200, { data: { id, workspace_id: workspaceId, ...payload, username: displayName, display_name: displayName, access_mode: mode } });
    }
    if (body.action === 'encrypt') {
      const id = requireUuid(body.id);
      const payload = asRecord(body.payload);
      const borrowerId = requireText(payload.borrower_id, { maxLen: 32 });
      const email = optionalText(payload.email, { maxLen: 254 });
      const result = await deps.callGateway('encrypt', { workspace_id: workspaceId, id, payload, index_fields: { borrower_id: borrowerId, ...(email ? { email } : {}) } }, gatewaySecret);
      if (typeof result.ciphertext !== 'string' || typeof result.nonce !== 'string' || typeof result.auth_tag !== 'string' || typeof result.borrower_id_hash !== 'string') throw new Error('Gateway unavailable');
      return reply(200, { data: { ...result, encrypted_data: result.ciphertext, key_version: 1 } });
    }
    if (body.action === 'restore') {
      const id = requireUuid(body.id);
      let restoreQuery = admin.from('borrowers').select('id,access_mode,encrypted_data,nonce,auth_tag,key_version').eq('workspace_id', workspaceId).eq('id', id).not('deleted_at', 'is', null);
      if (profile.role === 'individual_account') restoreQuery = restoreQuery.eq('access_mode', 'all');
      const { data: row, error: loadError } = await restoreQuery.maybeSingle();
      if (loadError || !row || !row.encrypted_data || !row.nonce || !row.auth_tag || row.key_version !== 1) return reply(404, { error: 'Borrower unavailable' });
      const result = await deps.callGateway('decrypt', { workspace_id: workspaceId, items: [{ id: row.id, ciphertext: row.encrypted_data, nonce: row.nonce, auth_tag: row.auth_tag }] }, gatewaySecret);
      if (!Array.isArray(result.items) || result.items.length !== 1 || result.items[0]?.id !== row.id) throw new Error('Gateway unavailable');
      const payload = result.items[0]?.payload;
      const firstName = typeof payload?.first_name === 'string' ? payload.first_name.trim() : '';
      const lastName = typeof payload?.last_name === 'string' ? payload.last_name.trim() : '';
      const name = firstName ? [firstName, lastName].filter(Boolean).join(' ') : typeof payload?.username === 'string' ? payload.username.trim() : '';
      if (!name || typeof payload?.borrower_id !== 'string') throw new Error('Gateway unavailable');
      const { data: restored, error: restoreError } = await admin.rpc('restore_encrypted_borrower', { p_workspace_id: workspaceId, p_actor_id: session.user.id, p_borrower_id: id, p_expected_ciphertext: row.encrypted_data, p_expected_nonce: row.nonce, p_expected_auth_tag: row.auth_tag });
      if (restoreError || restored !== true) return reply(restoreError?.code === '23505' ? 409 : 503, { error: 'Unable to restore borrower' });
      return reply(200, { data: { id: row.id, workspace_id: workspaceId, access_mode: row.access_mode, username: name, display_name: name, first_name: firstName || null, last_name: lastName || null, borrower_id: payload.borrower_id, email: typeof payload.email === 'string' ? payload.email : null } });
    }
    if (body.action === 'list') {
      const page = body.page;
      const size = body.page_size;
      if (!Number.isSafeInteger(page) || !Number.isSafeInteger(size) || (page as number) < 0 || (size as number) < 1 || (size as number) > 50 || (page as number) * (size as number) > 100000) throw new ValidationError();
      const offset = (page as number) * (size as number);
      if (body.archived !== undefined && typeof body.archived !== 'boolean') throw new ValidationError();
      // Tenant rows must be selected with the caller's JWT so Postgres RLS
      // applies workspace, active-session, and restricted-borrower grants.
      const individual = profile.role === 'individual_account';
      let query = (tenantDirectory || (individual && body.archived !== true) ? user : admin).from('borrowers').select('id,access_mode,encrypted_data,nonce,auth_tag,key_version').eq('workspace_id', workspaceId);
      if (individual && body.archived === true) query = query.eq('access_mode', 'all');
      query = body.archived === true ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);
      const { data: rows, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + (size as number));
      if (error || !rows) return reply(503, { error: 'Service unavailable' });
      const hasMore = rows.length > (size as number);
      const selected = rows.slice(0, size as number);
      if (selected.some((row: any) => !row.encrypted_data || !row.nonce || !row.auth_tag || row.key_version !== 1)) return reply(503, { error: 'Borrower data unavailable' });
      if (!selected.length) return reply(200, { data: { rows: [], hasMore: false } });
      const items = selected.map((row: any) => ({ id: row.id, ciphertext: row.encrypted_data, nonce: row.nonce, auth_tag: row.auth_tag }));
      const result = await deps.callGateway('decrypt', { workspace_id: workspaceId, items }, gatewaySecret);
      if (!Array.isArray(result.items) || result.items.length !== selected.length) throw new Error('Gateway unavailable');
      const byId = new Map(result.items.map((item: any) => [item.id, item.payload]));
      if (byId.size !== selected.length) throw new Error('Gateway unavailable');
      const decrypted = selected.map((row: any) => {
        const payload: any = byId.get(row.id);
        if (!payload || typeof payload.borrower_id !== 'string') throw new Error('Gateway unavailable');
        const firstName = typeof payload.first_name === 'string' ? payload.first_name.trim() : '';
        const lastName = typeof payload.last_name === 'string' ? payload.last_name.trim() : '';
        const legacyName = typeof payload.username === 'string' ? payload.username.trim() : '';
        const name = firstName ? [firstName, lastName].filter(Boolean).join(' ') : legacyName;
        if (!name) throw new Error('Gateway unavailable');
        if (tenantDirectory) return { id: row.id, workspace_id: workspaceId, username: name, borrower_id: payload.borrower_id };
        return { id: row.id, workspace_id: workspaceId, access_mode: row.access_mode, username: name, borrower_id: payload.borrower_id, first_name: firstName || null, last_name: lastName || null, display_name: name, email: typeof payload.email === 'string' ? payload.email : null };
      });
      return reply(200, { data: { rows: decrypted, hasMore } });
    }
    if (body.action === 'decrypt-log-borrowers') {
      if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 100) throw new ValidationError();
      const ids = body.ids.map(requireUuid);
      if (new Set(ids.map((id: string) => id.toLowerCase())).size !== ids.length) throw new ValidationError();
      // Check the actual history rows through caller RLS before using the
      // privileged client to read associated active or archived ciphertext.
      const { data: logs, error: logError } = await user.from('item_logs').select('id,checked_out_by').eq('workspace_id', workspaceId).in('id', ids);
      if (logError || !logs || logs.length !== ids.length) return reply(404, { error: 'History unavailable' });
      const borrowerIds = [...new Set(logs.flatMap((log: any) => log.checked_out_by ? [log.checked_out_by] : []))];
      const byBorrower = new Map<string, { username: string; borrower_id: string }>();
      if (borrowerIds.length) {
        const borrowerClient = profile.role === 'individual_account' ? user : admin;
        const { data: rows, error } = await borrowerClient.from('borrowers').select('id,access_mode,deleted_at,encrypted_data,nonce,auth_tag,key_version').eq('workspace_id', workspaceId).in('id', borrowerIds);
        if (error || !rows || rows.length !== borrowerIds.length || rows.some((row: any) => !row.encrypted_data || !row.nonce || !row.auth_tag || row.key_version !== 1)) return reply(503, { error: 'History unavailable' });
        if (profile.role === 'individual_account' && rows.some((row: any) => row.access_mode !== 'all' || row.deleted_at !== null)) return reply(404, { error: 'History unavailable' });
        const result = await deps.callGateway('decrypt', { workspace_id: workspaceId, items: rows.map((row: any) => ({ id: row.id, ciphertext: row.encrypted_data, nonce: row.nonce, auth_tag: row.auth_tag })) }, gatewaySecret);
        if (!Array.isArray(result.items) || result.items.length !== rows.length) throw new Error('Gateway unavailable');
        const expected = new Set(rows.map((row: any) => row.id));
        for (const item of result.items) {
          if (!expected.has(item?.id) || byBorrower.has(item.id)) throw new Error('Gateway unavailable');
          const payload = item.payload;
          const first = typeof payload?.first_name === 'string' ? payload.first_name.trim() : '';
          const last = typeof payload?.last_name === 'string' ? payload.last_name.trim() : '';
          const username = first ? [first, last].filter(Boolean).join(' ') : typeof payload?.username === 'string' ? payload.username.trim() : '';
          if (!username || typeof payload?.borrower_id !== 'string' || !payload.borrower_id.trim()) throw new Error('Gateway unavailable');
          byBorrower.set(item.id, { username, borrower_id: payload.borrower_id });
        }
      }
      return reply(200, { data: logs.map((log: any) => ({ id: log.id, borrower: log.checked_out_by ? byBorrower.get(log.checked_out_by) : null })) });
    }
    if (body.action === 'decrypt') {
      if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 100) throw new ValidationError();
      const ids = body.ids.map(requireUuid);
      if (new Set(ids.map((id: string) => id.toLowerCase())).size !== ids.length) throw new ValidationError();
      const borrowerClient = profile.role === 'individual_account' ? user : admin;
      const { data: rows, error } = await borrowerClient.from('borrowers').select('id,encrypted_data,nonce,auth_tag,key_version').eq('workspace_id', workspaceId).is('deleted_at', null).in('id', ids);
      if (error || !rows || rows.length !== ids.length || rows.some((row: any) => !row.encrypted_data || !row.nonce || !row.auth_tag || row.key_version !== 1)) return reply(404, { error: 'Borrower unavailable' });
      const items = rows.map((row: any) => ({ id: row.id, ciphertext: row.encrypted_data, nonce: row.nonce, auth_tag: row.auth_tag }));
      const result = await deps.callGateway('decrypt', { workspace_id: workspaceId, items }, gatewaySecret);
      if (!Array.isArray(result.items) || result.items.length !== ids.length) throw new Error('Gateway unavailable');
      return reply(200, { data: result.items });
    }
    if (body.action === 'hash-index') {
      const values = asRecord(body.values);
      const borrowerId = optionalText(values.borrower_id, { maxLen: 32 });
      const email = optionalText(values.email, { maxLen: 254 });
      if (!borrowerId && !email) throw new ValidationError();
      const result = await deps.callGateway('hash-index', { workspace_id: workspaceId, values: { ...(borrowerId ? { borrower_id: borrowerId } : {}), ...(email ? { email } : {}) } }, gatewaySecret);
      return reply(200, { data: result });
    }
    return reply(400, { error: 'Invalid request' });
  } catch (error) {
    if (error instanceof ValidationError) return reply(error.status, { error: 'Invalid request' });
    return reply(503, { error: 'Service unavailable' });
  }
  };
}
