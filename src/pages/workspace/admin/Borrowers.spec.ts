import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import { clearAuthState, getAuthState, setAuthStateFromBackend, setWorkspaceContext } from '../../../store/authState';
const { active, archived } = vi.hoisted(() => ({ active: vi.fn(), archived: vi.fn() }));
vi.mock('vue-router', () => ({ RouterLink: { template: '<a><slot /></a>' } }));
vi.mock('../../../services/borrowerService', () => ({ fetchBorrowers: active, fetchDeletedBorrowers: archived, fetchBorrowerAccessGrants: vi.fn(), fetchBorrowerDetails: vi.fn(), createBorrower: vi.fn(), deleteBorrower: vi.fn(), restoreBorrower: vi.fn(), updateBorrowerAccess: vi.fn() }));
vi.mock('../../../services/workspaceAdminManageService', () => ({ listTenantAccounts: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../services/exportService', () => ({ exportRowsToCsv: vi.fn(), exportRowsToPdf: vi.fn() }));
import Borrowers from './Borrowers.vue';

beforeEach(() => { clearAuthState(); setAuthStateFromBackend({ isAuthenticated: true, userId: 'user-1', role: 'workspace_admin' }); setWorkspaceContext('workspace-1'); active.mockReset(); archived.mockReset(); archived.mockResolvedValue([]); });
it('clears decrypted borrowers on logout and discards an in-flight directory', async () => {
  let resolve!: (value: unknown) => void;
  active.mockReturnValue(new Promise(done => { resolve = done; }));
  const wrapper = mount(Borrowers, { global: { stubs: { SkeletonLoader: true, BoneyardSkeleton: true, BoneyardTableFixture: true, TenantAccessPicker: true } } });
  await flushPromises();
  getAuthState().isAuthenticated = false;
  await flushPromises();
  resolve([{ id: 'id-1', username: 'Private Borrower', borrower_id: 'PRIVATE1', access_mode: 'all' }]);
  await flushPromises();
  expect(wrapper.text()).not.toContain('Private Borrower');
  wrapper.unmount();
});
