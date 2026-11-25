import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { gatewayOriginForProject } from './gateway-origin.mjs';

test('backfill pairs each database with its own gateway and rejects unknown projects', () => {
  assert.equal(gatewayOriginForProject('https://mlaspkufocikfcbjgpof.supabase.co'), 'https://sgw.itemtraxx.com');
  assert.equal(gatewayOriginForProject('https://nwuhjxicaopkmqydjlas.supabase.co'), 'https://itemtraxx-sgw-staging.itemtraxx-co.workers.dev');
  for (const value of ['https://evil.example', 'toString', 'https://nwuhjxicaopkmqydjlas.supabase.co/']) {
    assert.throws(() => gatewayOriginForProject(value), /Unknown database project/);
  }
});
