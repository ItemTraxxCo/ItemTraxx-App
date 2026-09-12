<template>
  <main class="page">
    <div class="sa-toolbar">
      <div>
        <RouterLink to="/super-admin" class="sa-back-link">&larr; Back to Control Center</RouterLink>
        <h1 class="sa-toolbar-title">Tenant Accounts</h1>
        <p class="sa-toolbar-sub">Manage checkout-desk accounts across every workspace.</p>
      </div>
    </div>

    <section class="sa-panel sa-filters">
      <label>Search <input v-model="search" placeholder="Email or workspace" @keyup.enter="load" /></label>
      <label>Workspace
        <select v-model="workspaceId" @change="load">
          <option value="all">All workspaces</option>
          <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">{{ workspace.name }}</option>
        </select>
      </label>
      <button class="sa-btn" :disabled="loading" @click="load">Search</button>
    </section>

    <section class="sa-panel">
      <h2>Create Tenant Account</h2>
      <form @submit.prevent="create">
        <select v-model="createWorkspaceId" required>
          <option value="" disabled>Select workspace</option>
          <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">{{ workspace.name }}</option>
        </select>
        <input v-model="createEmail" type="email" placeholder="account@example.com" required />
        <div class="panel-actions">
          <button class="sa-btn primary" :disabled="saving">Create and send setup</button>
        </div>
      </form>
    </section>

    <p v-if="message" class="sa-notice" role="status">{{ message }}</p>
    <p v-if="error" class="sa-error" role="alert">{{ error }}</p>

    <div class="sa-table-wrap">
      <table class="sa-table">
        <thead><tr><th>Email</th><th>Workspace</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-for="account in accounts" :key="account.id">
            <td><input v-model="account.auth_email" type="email" :aria-label="`Email for ${account.workspace_name}`" /></td>
            <td>{{ account.workspace_name }}</td>
            <td>
              <span class="sa-tag" :class="account.is_active ? 'ok' : 'warn'">
                {{ account.is_active ? 'Active' : 'Suspended' }}
              </span>
            </td>
            <td>
              <div class="sa-table-row-actions">
                <button class="sa-btn" :disabled="saving || emailUnchanged(account)" @click="saveEmail(account)">Save email</button>
                <button class="sa-btn" @click="toggle(account)">{{ account.is_active ? 'Suspend' : 'Restore' }}</button>
                <button class="sa-btn" @click="reset(account)">Reset password</button>
                <button class="sa-btn danger" @click="remove(account)">Remove</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !accounts.length"><td colspan="4">No Tenant Accounts found.</td></tr>
        </tbody>
      </table>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { listWorkspaces, type SuperWorkspace } from "../../services/superWorkspaceService";
import {
  createTenantAccount,
  listTenantAccounts,
  removeTenantAccount,
  sendTenantAccountReset,
  setTenantAccountStatus,
  updateTenantAccountEmail,
  type SuperTenantAccount,
} from "../../services/superTenantAccountService";

const accounts = ref<SuperTenantAccount[]>([]);
const workspaces = ref<SuperWorkspace[]>([]);
const search = ref("");
const workspaceId = ref("all");
const createWorkspaceId = ref("");
const createEmail = ref("");
const loading = ref(false);
const saving = ref(false);
const message = ref("");
const error = ref("");
const savedEmails = ref<Record<string, string>>({});

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const emailUnchanged = (account: SuperTenantAccount) =>
  normalizeEmail(account.auth_email) === savedEmails.value[account.id];

const run = async (operation: () => Promise<void>) => {
  saving.value = true;
  message.value = "";
  error.value = "";
  try { await operation(); } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Tenant Account request failed.";
  } finally { saving.value = false; }
};
const load = async () => {
  loading.value = true;
  error.value = "";
  try {
    accounts.value = await listTenantAccounts(search.value, workspaceId.value);
    savedEmails.value = Object.fromEntries(
      accounts.value.map((account) => [account.id, normalizeEmail(account.auth_email)]),
    );
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "Unable to load Tenant Accounts."; }
  finally { loading.value = false; }
};
const create = () => run(async () => {
  await createTenantAccount(createWorkspaceId.value, createEmail.value);
  createEmail.value = "";
  message.value = "Tenant Account created and setup email sent.";
  await load();
});
const saveEmail = (account: SuperTenantAccount) => run(async () => {
  await updateTenantAccountEmail(account.id, account.auth_email);
  message.value = "Tenant Account email updated.";
  await load();
});
const toggle = (account: SuperTenantAccount) => run(async () => {
  await setTenantAccountStatus(account.id, !account.is_active);
  await load();
});
const reset = (account: SuperTenantAccount) => run(async () => {
  await sendTenantAccountReset(account.id);
  message.value = `Password reset sent to ${account.auth_email}.`;
});
const remove = (account: SuperTenantAccount) => {
  if (!confirm(`Remove ${account.auth_email}? Their active sessions will be revoked.`)) return;
  void run(async () => {
    await removeTenantAccount(account.id);
    message.value = "Tenant Account removed.";
    await load();
  });
};

onMounted(async () => {
  workspaces.value = await listWorkspaces();
  await load();
});
</script>

<style scoped>
.page {
  max-width: 1320px;
  margin: 0 auto;
  padding: 2rem;
}

.panel-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.sa-panel form {
  display: flex;
  gap: 0.75rem;
  align-items: flex-end;
  flex-wrap: wrap;
}

.sa-panel form select,
.sa-panel form input {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
}

.sa-table td input {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
}
</style>
