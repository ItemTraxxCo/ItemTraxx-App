import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuthState, getAuthState, setAuthStateFromBackend, setWorkspaceContext } from '../../store/authState';

const { fetchSortedBorrowers, fetchBorrowerPage } = vi.hoisted(() => ({ fetchSortedBorrowers: vi.fn(), fetchBorrowerPage: vi.fn() }));
vi.mock('../../services/borrowerService', () => ({
  fetchSortedBorrowers,
  fetchBorrowerPage,
  isEncryptedBorrowerDirectoryEnabled: () => true,
}));
import Borrowers from './Borrowers.vue';

describe('encrypted tenant borrower directory', () => {
  beforeEach(() => {
    clearAuthState(); setAuthStateFromBackend({ isAuthenticated: true, userId: 'user-1' }); setWorkspaceContext('workspace-1');
    fetchSortedBorrowers.mockReset(); fetchBorrowerPage.mockReset();
  });
  it('filters and paginates the decrypted directory, then clears it on sign-out', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ id: `id-${i}`, username: `Name ${String(i).padStart(2, '0')}`, borrower_id: `CODE${i}` }));
    fetchSortedBorrowers.mockResolvedValue(rows);
    const wrapper = mount(Borrowers);
    await flushPromises();
    expect(wrapper.text()).toContain('Name 00');
    expect(wrapper.text()).not.toContain('Name 20');
    await wrapper.get('input[type="search"]').setValue('CODE20');
    await flushPromises();
    expect(wrapper.text()).toContain('Name 20');
    expect(wrapper.text()).not.toContain('Name 00');
    expect(fetchBorrowerPage).not.toHaveBeenCalled();
    getAuthState().isAuthenticated = false;
    await flushPromises();
    expect(wrapper.text()).not.toContain('Name 20');
    expect(wrapper.find('input[type="search"]').exists()).toBe(false);
    wrapper.unmount();
  });
  it('discards an in-flight decrypted response when the session changes', async () => {
    let resolve!: (rows: unknown[]) => void;
    fetchSortedBorrowers.mockReturnValue(new Promise((done) => { resolve = done; }));
    const wrapper = mount(Borrowers);
    await flushPromises();
    getAuthState().isAuthenticated = false;
    await flushPromises();
    resolve([{ id: 'id-1', username: 'Private Name', borrower_id: 'PRIVATE1' }]);
    await flushPromises();
    expect(wrapper.text()).not.toContain('Private Name');
    wrapper.unmount();
  });
});
