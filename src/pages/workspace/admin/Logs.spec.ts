import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import { clearAuthState, getAuthState, setAuthStateFromBackend, setWorkspaceContext } from '../../../store/authState';

const { fetchItemLogs } = vi.hoisted(() => ({ fetchItemLogs: vi.fn() }));
vi.mock('../../../services/itemService', () => ({ fetchItemLogs }));
vi.mock('../../../composables/useManagerContext', () => ({ useManagerContext: () => ({ managerRoot: '/' }) }));
import Logs from './Logs.vue';

beforeEach(() => {
  clearAuthState(); setAuthStateFromBackend({ isAuthenticated: true, userId: 'admin-1' }); setWorkspaceContext('workspace-1');
  fetchItemLogs.mockReset();
});

it('clears decrypted history on sign-out and rejects an in-flight old-session response', async () => {
  let resolve!: (rows: unknown[]) => void;
  fetchItemLogs.mockReturnValue(new Promise((done) => { resolve = done; }));
  const wrapper = mount(Logs, { global: { stubs: { RouterLink: true, BoneyardSkeleton: { template: '<div><slot /></div>' }, BoneyardTableFixture: true } } });
  await flushPromises();
  getAuthState().isAuthenticated = false;
  await flushPromises();
  resolve([{ id: 'log-1', action_time: '2026-01-01', action_type: 'checkout', borrower: { username: 'Private Name', borrower_id: 'PRIVATE' }, item: null, tenant_account: null }]);
  await flushPromises();
  expect(wrapper.text()).not.toContain('Private Name');
  wrapper.unmount();
});
