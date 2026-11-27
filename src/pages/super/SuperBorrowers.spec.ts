import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { create, mode, list, listMetadata, workspaces } = vi.hoisted(() => ({ create: vi.fn(), mode: vi.fn(), list: vi.fn(), listMetadata: vi.fn(), workspaces: vi.fn() }));
vi.mock('vue-router', () => ({ RouterLink: { template: '<a><slot /></a>' }, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../services/superBorrowerService', () => ({ createSuperBorrower: create, deleteSuperBorrower: vi.fn(), getSuperBorrowerEncryptionMode: mode, listSuperBorrowerMetadata: listMetadata, listSuperBorrowers: list }));
vi.mock('../../services/superWorkspaceService', () => ({ listWorkspaces: workspaces }));
vi.mock('../../services/exportService', () => ({ exportRowsToCsv: vi.fn(), exportRowsToPdf: vi.fn() }));
import SuperBorrowers from './SuperBorrowers.vue';

describe('super-admin encrypted borrower creation', () => {
  beforeEach(() => { create.mockReset(); mode.mockReset(); list.mockReset(); listMetadata.mockReset(); workspaces.mockReset(); workspaces.mockResolvedValue([{ id: 'ws-1', name: 'Workspace' }]); list.mockResolvedValue([]); listMetadata.mockResolvedValue([]); mode.mockResolvedValue(true); create.mockResolvedValue({ id: 'id-1', workspace_id: 'ws-1', username: 'Ada Lovelace', borrower_id: 'ID123' }); });
  it('defaults to metadata-only listing when no JIT ticket is active', async () => {
    const wrapper = mount(SuperBorrowers, { global: { stubs: { SkeletonLoader: true, StepUpModal: true, SuperJitAccessBar: true } } });
    await flushPromises();
    expect(listMetadata).toHaveBeenCalledWith('all');
    expect(list).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('submits split names and clears them after creation', async () => {
    const wrapper = mount(SuperBorrowers, { global: { stubs: { SkeletonLoader: true, StepUpModal: true, SuperJitAccessBar: true } } });
    await flushPromises();
    await wrapper.get('form select').setValue('ws-1'); await flushPromises();
    const fields = wrapper.findAll('form input[type="text"]');
    await fields[0].setValue(' Ada '); await fields[1].setValue(' Lovelace '); await fields[2].setValue('ID123');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(create).toHaveBeenCalledWith({ workspace_id: 'ws-1', first_name: 'Ada', last_name: 'Lovelace', borrower_id: 'ID123', email: null });
    expect((fields[0].element as HTMLInputElement).value).toBe('');
    expect(wrapper.text()).not.toContain('Regenerate');
    wrapper.unmount();
  });
  it('submits free input with no last name', async () => {
    const wrapper = mount(SuperBorrowers, { global: { stubs: { SkeletonLoader: true, StepUpModal: true, SuperJitAccessBar: true } } });
    await flushPromises(); await wrapper.get('form select').setValue('ws-1'); await flushPromises();
    await wrapper.get('input[value="free"]').setValue();
    const fields = wrapper.findAll('form input[type="text"]');
    await fields[0].setValue('Room Cart'); await fields[1].setValue('CART1');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ first_name: 'Room Cart', last_name: null, borrower_id: 'CART1' }));
    wrapper.unmount();
  });
});
