<template>
  <main class="page admin-shell">
    <RouterLink to="/admin">Back</RouterLink>
    <h1>Workspace Accounts</h1>
    <p class="page-intro">View workspace members and manage their tenant or admin role.</p>

    <section class="card">
      <h2>Invite User</h2>
      <p class="muted">New invitations stay pending and do not appear in Accounts until the recipient accepts. Accounts provisioned through workspace SSO appear after the user signs in. New invited accounts start as Tenant Accounts; after acceptance, you can change the role to Workspace Admin.</p>
      <form class="add-account-form" @submit.prevent="create">
        <label>
          Email address
          <input v-model.trim="email" type="email" autocomplete="email" data-session-replay-mask required />
        </label>
        <button type="submit" :disabled="isCreating">
          {{ isCreating ? "Sending invitation…" : "Send invitation" }}
        </button>
      </form>
    </section>

    <section class="card">
      <div class="section-heading">
        <div>
          <h2>Accounts</h2>
          <p class="muted">Role changes take effect the next time the account signs in.</p>
        </div>
        <button type="button" :disabled="isLoading || isCreating || accountActionId !== null || savingRoleId !== null || isSavingAdminDetails" @click="load">
          {{ isLoading ? "Loading…" : "Reload accounts" }}
        </button>
      </div>

      <p v-if="error" class="error" role="alert" v-app-toast-error>{{ error }}</p>
      <p v-if="message" class="success" role="status" v-app-toast-message>{{ message }}</p>

      <div class="table-wrap">
        <table class="table accounts-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="account in accounts" :key="account.id">
              <td>
                <span data-session-replay-mask>{{ account.auth_email || "No email on file" }}</span>
                <span v-if="account.is_primary_admin" class="account-note">Primary admin</span>
                <span v-else-if="account.id === currentProfileId" class="account-note">You</span>
              </td>
              <td>
                <select
                  :value="pendingRoles[account.id] ?? account.role"
                  :disabled="!canChangeRole(account) || isLoading || accountActionId !== null || savingRoleId === account.id"
                  :aria-label="`Role for ${account.auth_email || 'workspace account'}`"
                  @change="selectRole(account, $event)"
                >
                  <option value="tenant_account">Tenant Account</option>
                  <option value="workspace_admin">Workspace Admin</option>
                </select>
              </td>
              <td>{{ account.is_active ? "Active" : account.role === "workspace_admin" ? "Disabled" : "Suspended" }}</td>
              <td>
                <div class="account-actions">
                  <button
                    v-if="hasRoleChange(account)"
                    type="button"
                    :disabled="savingRoleId === account.id || isLoading || accountActionId !== null"
                    @click="saveRole(account)"
                  >
                    {{ savingRoleId === account.id ? "Saving…" : "Save role" }}
                  </button>
                  <template v-if="account.role === 'tenant_account'">
                    <button type="button" :disabled="accountActionId !== null || isLoading || hasRoleChange(account)" @click="toggle(account)">
                      {{ account.is_active ? "Suspend" : "Restore" }}
                    </button>
                    <button type="button" :disabled="accountActionId !== null || isLoading || hasRoleChange(account)" @click="reset(account.id)">
                      Send password reset
                    </button>
                    <button type="button" :disabled="accountActionId !== null || isLoading || hasRoleChange(account)" @click="remove(account)">
                      Remove
                    </button>
                  </template>
                  <button
                    v-if="account.role === 'workspace_admin' && canManageAdminDetails && !account.is_primary_admin"
                    type="button"
                    :disabled="accountActionId !== null || isLoading || isSavingAdminDetails"
                    @click="openAdminDetails(account)"
                  >
                    Manage admin
                  </button>
                  <span v-if="account.is_primary_admin" class="muted">Role is fixed</span>
                  <span v-else-if="account.id === currentProfileId" class="muted">Your role is fixed</span>
                </div>
              </td>
            </tr>
            <tr v-if="!isLoading && !accounts.length">
              <td colspan="4" class="empty-state">No workspace accounts found.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="adminDetailsTarget" class="modal-backdrop" @click.self="closeAdminDetails">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="admin-details-title">
        <h2 id="admin-details-title">Manage Workspace Admin</h2>
        <p class="muted">The account owner can change their sign-in email in Account Security after approving both the current and new email addresses.</p>
        <p v-if="error" class="error" role="alert" v-app-toast-error>{{ error }}</p>
        <div class="admin-details-form">
          <div class="admin-details-actions">
            <button type="button" :disabled="isSavingAdminDetails" @click="sendAdminReset">
              Send reset link
            </button>
            <button type="button" :disabled="isSavingAdminDetails" @click="toggleAdminStatus">
              {{ adminDetailsTarget.is_active ? "Disable" : "Re-enable" }} account
            </button>
            <button type="button" :disabled="isSavingAdminDetails" @click="closeAdminDetails">Cancel</button>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { getAuthState } from "../../../store/authState";
import { toUserFacingErrorMessage } from "../../../services/appErrors";
import {
  createTenantAccount,
  listWorkspaceAccounts,
  removeTenantAccount,
  sendTenantAccountReset,
  setTenantAccountStatus,
  setWorkspaceAccountRole,
  sendTenantManagedAdminReset,
  setTenantManagedAdminStatus,
  type WorkspaceAccount,
  type WorkspaceAccountRole,
} from "../../../services/workspaceAdminManageService";

const accounts = ref<WorkspaceAccount[]>([]);
const pendingRoles = ref<Record<string, WorkspaceAccountRole>>({});
const email = ref("");
const message = ref("");
const error = ref("");
const canManageAdminDetails = ref(false);
const isLoading = ref(false);
const isCreating = ref(false);
const isSavingAdminDetails = ref(false);
const savingRoleId = ref<string | null>(null);
const accountActionId = ref<string | null>(null);
const currentProfileId = getAuthState().userId;
const adminDetailsTarget = ref<WorkspaceAccount | null>(null);

const load = async () => {
  isLoading.value = true;
  error.value = "";
  message.value = "";
  try {
    const result = await listWorkspaceAccounts();
    accounts.value = result.accounts;
    canManageAdminDetails.value = result.can_manage_admins;
    pendingRoles.value = {};
  } catch (cause) {
    error.value = toUserFacingErrorMessage(cause, "Unable to load workspace accounts.");
  } finally {
    isLoading.value = false;
  }
};

const canChangeRole = (account: WorkspaceAccount) =>
  canManageAdminDetails.value &&
  !account.is_primary_admin &&
  account.id !== currentProfileId &&
  adminDetailsTarget.value === null;

const hasRoleChange = (account: WorkspaceAccount) =>
  pendingRoles.value[account.id] !== undefined &&
  pendingRoles.value[account.id] !== account.role;

const selectRole = (account: WorkspaceAccount, event: Event) => {
  const role = (event.target as HTMLSelectElement).value as WorkspaceAccountRole;
  if (role === account.role) {
    delete pendingRoles.value[account.id];
    return;
  }
  pendingRoles.value[account.id] = role;
};

const create = async () => {
  isCreating.value = true;
  error.value = "";
  message.value = "";
  try {
    const result = await createTenantAccount(email.value);
    email.value = "";
    message.value = result.message;
  } catch (cause) {
    error.value = toUserFacingErrorMessage(cause, "Unable to invite the user.");
  } finally {
    isCreating.value = false;
  }
};

const saveRole = async (account: WorkspaceAccount) => {
  const role = pendingRoles.value[account.id];
  if (!role || role === account.role) return;
  const nextRoleLabel = role === "workspace_admin" ? "Workspace Admin" : "Tenant Account";
  const accountLabel = account.auth_email || "this account";
  if (!window.confirm(`Change ${accountLabel} to ${nextRoleLabel}?`)) return;

  savingRoleId.value = account.id;
  error.value = "";
  message.value = "";
  try {
    const updated = await setWorkspaceAccountRole({ id: account.id, role });
    const index = accounts.value.findIndex((item) => item.id === updated.id);
    if (index >= 0) accounts.value[index] = updated;
    delete pendingRoles.value[account.id];
    message.value = `${accountLabel} is now a ${nextRoleLabel}. The change takes effect on their next sign-in.`;
  } catch (cause) {
    error.value = toUserFacingErrorMessage(cause, "Unable to update the account role.");
  } finally {
    savingRoleId.value = null;
  }
};

const openAdminDetails = (account: WorkspaceAccount) => {
  if (!canManageAdminDetails.value || account.is_primary_admin) return;
  adminDetailsTarget.value = account;
  error.value = "";
  message.value = "";
};

const clearAdminDetails = () => {
  adminDetailsTarget.value = null;
};

const closeAdminDetails = () => {
  if (isSavingAdminDetails.value) return;
  clearAdminDetails();
};

const replaceAccount = (updated: WorkspaceAccount) => {
  const index = accounts.value.findIndex((account) => account.id === updated.id);
  if (index >= 0) accounts.value[index] = updated;
};

const toggleAdminStatus = async () => {
  const target = adminDetailsTarget.value;
  if (!target) return;
  const isActive = !target.is_active;
  if (!isActive && !window.confirm(`Disable ${target.auth_email || "this Workspace Admin"}?`)) return;

  isSavingAdminDetails.value = true;
  error.value = "";
  try {
    const updated = await setTenantManagedAdminStatus({ id: target.id, is_active: isActive });
    replaceAccount(updated);
    message.value = isActive ? "Workspace Admin re-enabled." : "Workspace Admin disabled.";
    clearAdminDetails();
  } catch (cause) {
    error.value = toUserFacingErrorMessage(cause, "Unable to update workspace admin status.");
  } finally {
    isSavingAdminDetails.value = false;
  }
};

const sendAdminReset = async () => {
  const target = adminDetailsTarget.value;
  if (!target) return;
  isSavingAdminDetails.value = true;
  error.value = "";
  try {
    await sendTenantManagedAdminReset({ auth_email: target.auth_email });
    message.value = "Workspace admin reset link requested.";
    clearAdminDetails();
  } catch (cause) {
    error.value = toUserFacingErrorMessage(cause, "Unable to send a workspace admin reset link.");
  } finally {
    isSavingAdminDetails.value = false;
  }
};

const toggle = async (account: WorkspaceAccount) => {
  accountActionId.value = account.id;
  error.value = "";
  message.value = "";
  try {
    await setTenantAccountStatus(account.id, !account.is_active);
    await load();
    if (!error.value) message.value = `Tenant Account ${account.is_active ? "suspended" : "restored"}.`;
  } catch (cause) {
    error.value = toUserFacingErrorMessage(cause, "Unable to update Tenant Account status.");
  } finally {
    accountActionId.value = null;
  }
};

const reset = async (id: string) => {
  accountActionId.value = id;
  error.value = "";
  message.value = "";
  try {
    await sendTenantAccountReset(id);
    message.value = "Password reset requested.";
  } catch (cause) {
    error.value = toUserFacingErrorMessage(cause, "Unable to request a password reset.");
  } finally {
    accountActionId.value = null;
  }
};

const remove = async (account: WorkspaceAccount) => {
  const accountLabel = account.auth_email || "this Tenant Account";
  if (!window.confirm(`Remove ${accountLabel}? Existing records are retained.`)) return;
  accountActionId.value = account.id;
  error.value = "";
  message.value = "";
  try {
    await removeTenantAccount(account.id);
    await load();
    if (!error.value) message.value = "Tenant Account removed.";
  } catch (cause) {
    error.value = toUserFacingErrorMessage(cause, "Unable to remove Tenant Account.");
  } finally {
    accountActionId.value = null;
  }
};

onMounted(() => void load());
</script>

<style scoped>
.page-intro {
  margin-top: -0.65rem;
  color: var(--muted);
}

.add-account-form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  align-items: flex-start;
}

.add-account-form label {
  display: grid;
  gap: 0.4rem;
  width: min(100%, 28rem);
}

.section-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}

.section-heading h2,
.section-heading p {
  margin-top: 0;
}

.accounts-table th:nth-child(1),
.accounts-table td:nth-child(1) {
  width: 28%;
}

.accounts-table th:nth-child(2),
.accounts-table td:nth-child(2) {
  width: 18%;
}

.accounts-table th:nth-child(3),
.accounts-table td:nth-child(3) {
  width: 12%;
}

.accounts-table th:nth-child(4),
.accounts-table td:nth-child(4) {
  width: 42%;
}

.account-note {
  display: block;
  margin-top: 0.2rem;
  color: var(--muted);
  font-size: 0.8rem;
}

.account-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  align-items: center;
}

.account-actions button {
  white-space: nowrap;
}

.empty-state {
  color: var(--muted);
  text-align: center;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(10, 14, 25, 0.55);
}

.modal {
  width: min(38rem, 100%);
  max-height: 90vh;
  overflow: auto;
  padding: 1.25rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}

.modal h2 {
  margin-top: 0;
}

.admin-details-form,
.admin-details-form label {
  display: grid;
  gap: 0.85rem;
}

.admin-details-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

@media (max-width: 760px) {
  .section-heading {
    flex-direction: column;
  }

  .accounts-table th:nth-child(1),
  .accounts-table td:nth-child(1),
  .accounts-table th:nth-child(2),
  .accounts-table td:nth-child(2),
  .accounts-table th:nth-child(3),
  .accounts-table td:nth-child(3),
  .accounts-table th:nth-child(4),
  .accounts-table td:nth-child(4) {
    width: auto;
  }
}
</style>
