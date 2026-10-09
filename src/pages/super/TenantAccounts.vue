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
      <button class="sa-btn" :disabled="loading || stepUpSubmitting" @click="load">Search</button>
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
          <button class="sa-btn primary" :disabled="saving || stepUpSubmitting">Create and send setup</button>
        </div>
      </form>
    </section>

    <p v-if="message" class="sa-notice" role="status" data-session-replay-mask v-app-toast-message>{{ message }}</p>
    <p v-if="error" class="sa-error" role="alert" v-app-toast-error>{{ error }}</p>

    <div class="sa-table-wrap">
      <table class="sa-table">
        <thead><tr><th>Email</th><th>Workspace</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-for="account in accounts" :key="account.id">
            <td><input v-model="account.auth_email" data-session-replay-mask type="email" :aria-label="`Email for ${account.workspace_name}`" /></td>
            <td>{{ account.workspace_name }}</td>
            <td>
              <span class="sa-tag" :class="account.is_active ? 'ok' : 'warn'">
                {{ account.is_active ? 'Active' : 'Suspended' }}
              </span>
            </td>
            <td>
              <div class="sa-table-row-actions">
                <button class="sa-btn" :disabled="saving || stepUpSubmitting || emailUnchanged(account)" @click="saveEmail(account)">Save email</button>
                <button class="sa-btn" :disabled="saving || stepUpSubmitting" @click="toggle(account)">{{ account.is_active ? 'Suspend' : 'Restore' }}</button>
                <button class="sa-btn" :disabled="saving || stepUpSubmitting" @click="reset(account)">Reset password</button>
                <button class="sa-btn danger" :disabled="saving || stepUpSubmitting" @click="remove(account)">Remove</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !accounts.length"><td colspan="4">No Tenant Accounts found.</td></tr>
        </tbody>
      </table>
    </div>

    <StepUpModal
      :visible="stepUpVisible"
      :title="stepUpTitle"
      :message="stepUpMessage"
      :confirm-label="stepUpConfirmLabel"
      :busy="stepUpSubmitting"
      :error="stepUpError"
      @cancel="cancelStepUp"
      @confirm="confirmStepUp"
    />
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import StepUpModal from "../../components/StepUpModal.vue";
import { useSuperAdminStepUp } from "../../composables/useSuperAdminStepUp";
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

const {
  visible: stepUpVisible,
  title: stepUpTitle,
  message: stepUpMessage,
  confirmLabel: stepUpConfirmLabel,
  error: stepUpError,
  isSubmitting: stepUpSubmitting,
  request: requestStepUp,
  cancel: cancelStepUp,
  confirm: confirmStepUp,
} = useSuperAdminStepUp((cause) => {
  error.value = cause instanceof Error ? cause.message : "Tenant Account action failed.";
});

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
const create = () => requestStepUp({
  title: "Create Tenant Account",
  message: `Type CONFIRM and enter your super admin password to create a Tenant Account for ${workspaces.value.find((workspace) => workspace.id === createWorkspaceId.value)?.name ?? "the selected workspace"} and send the setup email to ${createEmail.value}.`,
  confirmLabel: "Create Account",
}, () => run(async () => {
  await createTenantAccount(createWorkspaceId.value, createEmail.value);
  createEmail.value = "";
  message.value = "Tenant Account created and setup email sent.";
  await load();
}));
const saveEmail = (account: SuperTenantAccount) => requestStepUp({
  title: "Update Tenant Account Email",
  message: `Type CONFIRM and enter your super admin password to change ${savedEmails.value[account.id]} to ${normalizeEmail(account.auth_email)}.`,
  confirmLabel: "Save Email",
}, () => run(async () => {
  await updateTenantAccountEmail(account.id, account.auth_email);
  message.value = "Tenant Account email updated.";
  await load();
}));
const toggle = (account: SuperTenantAccount) => requestStepUp({
  title: `${account.is_active ? "Suspend" : "Restore"} Tenant Account`,
  message: `Type CONFIRM and enter your super admin password to ${account.is_active ? "suspend" : "restore"} ${account.auth_email}.`,
  confirmLabel: account.is_active ? "Suspend" : "Restore",
}, () => run(async () => {
  await setTenantAccountStatus(account.id, !account.is_active);
  await load();
}));
const reset = (account: SuperTenantAccount) => requestStepUp({
  title: "Send Tenant Account Reset",
  message: `Type CONFIRM and enter your super admin password to send a password reset to ${account.auth_email}.`,
  confirmLabel: "Send Reset",
}, () => run(async () => {
  await sendTenantAccountReset(account.id);
  message.value = `Password reset sent to ${account.auth_email}.`;
}));
const remove = (account: SuperTenantAccount) => {
  requestStepUp({
    title: "Remove Tenant Account",
    message: `Type CONFIRM and enter your super admin password to remove ${account.auth_email}. Their active sessions will be revoked.`,
    confirmLabel: "Remove Account",
  }, () => run(async () => {
    await removeTenantAccount(account.id);
    message.value = "Tenant Account removed.";
    await load();
  }));
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
