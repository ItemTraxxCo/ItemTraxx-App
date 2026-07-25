<template>
  <main class="page">
    <RouterLink to="/super-admin">Back to Control Center</RouterLink>
    <h1>Tenant Accounts</h1>
    <p>Manage checkout-desk accounts across every workspace.</p>

    <section class="card filters">
      <label>Search <input v-model="search" placeholder="Email or workspace" @keyup.enter="load" /></label>
      <label>Workspace
        <select v-model="workspaceId" @change="load">
          <option value="all">All workspaces</option>
          <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">{{ workspace.name }}</option>
        </select>
      </label>
      <button :disabled="loading" @click="load">Search</button>
    </section>

    <section class="card">
      <h2>Create Tenant Account</h2>
      <form class="actions" @submit.prevent="create">
        <select v-model="createWorkspaceId" required>
          <option value="" disabled>Select workspace</option>
          <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">{{ workspace.name }}</option>
        </select>
        <input v-model="createEmail" type="email" placeholder="account@example.com" required />
        <button class="button-primary" :disabled="saving">Create and send setup</button>
      </form>
    </section>

    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="table-wrap">
      <table>
        <thead><tr><th>Email</th><th>Workspace</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-for="account in accounts" :key="account.id">
            <td><input v-model="account.auth_email" type="email" :aria-label="`Email for ${account.workspace_name}`" /></td>
            <td>{{ account.workspace_name }}</td>
            <td>{{ account.is_active ? 'Active' : 'Suspended' }}</td>
            <td class="row-actions">
              <button :disabled="saving || emailUnchanged(account)" @click="saveEmail(account)">Save email</button>
              <button @click="toggle(account)">{{ account.is_active ? 'Suspend' : 'Restore' }}</button>
              <button @click="reset(account)">Reset password</button>
              <button @click="remove(account)">Remove</button>
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
