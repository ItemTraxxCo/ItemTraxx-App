<template>
  <main class="page">
    <div class="sa-toolbar">
      <div>
        <RouterLink to="/super-admin" class="sa-back-link">&larr; Back to Control Center</RouterLink>
        <h1 class="sa-toolbar-title">Workspace Admins</h1>
        <p class="sa-toolbar-sub">Manage admin roles, reset credentials, and assign primary admin status across workspaces.</p>
      </div>
    </div>

    <section class="sa-panel sa-filters">
      <label>Search <input v-model="search" placeholder="Email address" @keyup.enter="load" /></label>
      <label>Workspace
        <select v-model="workspaceId" @change="load">
          <option value="all">All workspaces</option>
          <option v-for="w in workspaces" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </label>
      <button class="sa-btn" :disabled="loading || saving || stepUpSubmitting" @click="load">Search</button>
    </section>

    <section class="sa-panel">
      <h2>Create Workspace Admin</h2>
      <form @submit.prevent="create">
        <div class="form-fields">
          <label>Workspace
            <select v-model="createWorkspaceId" required>
              <option value="" disabled>Select workspace</option>
              <option v-for="w in workspaces" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </label>
          <label>Email
            <input v-model="email" type="email" required />
          </label>
        </div>
        <div class="panel-actions">
          <button type="submit" class="sa-btn primary" :disabled="saving || stepUpSubmitting">Create and send setup</button>
        </div>
      </form>
    </section>

    <p v-if="message" class="sa-notice" role="status" v-app-toast-message>{{ message }}</p>
    <p v-if="error" class="sa-error" role="alert" v-app-toast-error>{{ error }}</p>

    <div class="sa-table-wrap">
      <table class="sa-table">
        <thead><tr><th>Email</th><th>Workspace</th><th>Primary</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-for="a in admins" :key="a.id">
            <td><span data-session-replay-mask>{{ a.auth_email }}</span></td>
            <td>{{ a.workspace_name }}</td>
            <td><span class="sa-tag" :class="a.is_primary_admin ? 'ok' : 'info'">{{ a.is_primary_admin ? 'Yes' : 'No' }}</span></td>
            <td><span class="sa-tag" :class="a.is_active ? 'ok' : 'warn'">{{ a.is_active ? 'Active' : 'Suspended' }}</span></td>
            <td>
              <div class="sa-table-row-actions">
                <button class="sa-btn" :disabled="saving || stepUpSubmitting || a.is_primary_admin" @click="toggle(a)">{{ a.is_active ? 'Suspend' : 'Restore' }}</button>
                <button class="sa-btn" :disabled="saving || stepUpSubmitting" @click="reset(a)">Reset password</button>
                <button class="sa-btn" :disabled="saving || stepUpSubmitting" @click="primary(a)">Make primary</button>
              </div>
            </td>
          </tr>
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
import {
  createWorkspaceAdmin,
  listWorkspaceAdmins,
  sendWorkspaceAdminReset,
  setWorkspaceAdminStatus,
  type SuperWorkspaceAdmin,
} from "../../services/superWorkspaceAdminService";
import {
  listWorkspaces,
  setPrimaryWorkspaceAdmin,
  type SuperWorkspace,
} from "../../services/superWorkspaceService";

const admins = ref<SuperWorkspaceAdmin[]>([]);
const workspaces = ref<SuperWorkspace[]>([]);
const search = ref("");
const workspaceId = ref("all");
const createWorkspaceId = ref("");
const email = ref("");
const loading = ref(false);
const saving = ref(false);
const message = ref("");
const error = ref("");

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
  error.value = cause instanceof Error ? cause.message : "Workspace Admin action failed.";
});

const run = async (operation: () => Promise<void>, success: string) => {
  saving.value = true;
  message.value = "";
  error.value = "";
  try {
    await operation();
    message.value = success;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Workspace Admin request failed.";
  } finally {
    saving.value = false;
  }
};

const load = async () => {
  loading.value = true;
  error.value = "";
  try {
    admins.value = await listWorkspaceAdmins(search.value, workspaceId.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Unable to load Workspace Admins.";
  } finally {
    loading.value = false;
  }
};

const create = () => requestStepUp({
  title: "Create Workspace Admin",
  message: `Type CONFIRM and enter your super admin password to create an admin for ${workspaces.value.find((workspace) => workspace.id === createWorkspaceId.value)?.name ?? "the selected workspace"} and send the setup email to ${email.value}.`,
  confirmLabel: "Create Admin",
}, () => run(async () => {
  await createWorkspaceAdmin(createWorkspaceId.value, email.value);
  email.value = "";
  await load();
}, "Workspace Admin created and setup email sent."));

const toggle = (admin: SuperWorkspaceAdmin) => requestStepUp({
  title: `${admin.is_active ? "Suspend" : "Restore"} Workspace Admin`,
  message: `Type CONFIRM and enter your super admin password to ${admin.is_active ? "suspend" : "restore"} ${admin.auth_email}.`,
  confirmLabel: admin.is_active ? "Suspend" : "Restore",
}, () => run(async () => {
  await setWorkspaceAdminStatus(admin.id, !admin.is_active);
  await load();
}, "Workspace Admin status updated."));

const reset = (admin: SuperWorkspaceAdmin) => requestStepUp({
  title: "Send Workspace Admin Reset",
  message: `Type CONFIRM and enter your super admin password to send a password reset to ${admin.auth_email}.`,
  confirmLabel: "Send Reset",
}, () => run(async () => {
  await sendWorkspaceAdminReset(admin.id);
}, "Password reset email sent."));

const primary = (admin: SuperWorkspaceAdmin) => {
  requestStepUp({
    title: "Reassign Primary Workspace Admin",
    message: `Type CONFIRM and enter your super admin password to make ${admin.auth_email} the primary admin for ${admin.workspace_name ?? "this workspace"}.`,
    confirmLabel: "Make Primary",
  }, () => run(async () => {
    await setPrimaryWorkspaceAdmin(admin.workspace_id, admin.id);
    await load();
  }, "Primary Workspace Admin reassigned."));
};

onMounted(async () => {
  try {
    workspaces.value = await listWorkspaces();
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Unable to load Workspace Admins.";
  }
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

.form-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-bottom: 0;
}

.form-fields label {
  display: grid;
  gap: 0.35rem;
}

.form-fields input,
.form-fields select {
  font: inherit;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
}

@media (max-width: 520px) {
  .form-fields {
    grid-template-columns: 1fr;
  }
}
</style>
