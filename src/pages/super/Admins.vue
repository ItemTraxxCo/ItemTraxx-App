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
      <button class="sa-btn" :disabled="loading || saving" @click="load">Search</button>
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
          <button type="submit" class="sa-btn primary" :disabled="saving">Create and send setup</button>
        </div>
      </form>
    </section>

    <p v-if="message" class="sa-notice" role="status">{{ message }}</p>
    <p v-if="error" class="sa-error" role="alert">{{ error }}</p>

    <div class="sa-table-wrap">
      <table class="sa-table">
        <thead><tr><th>Email</th><th>Workspace</th><th>Primary</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-for="a in admins" :key="a.id">
            <td>{{ a.auth_email }}</td>
            <td>{{ a.workspace_name }}</td>
            <td><span class="sa-tag" :class="a.is_primary_admin ? 'ok' : 'info'">{{ a.is_primary_admin ? 'Yes' : 'No' }}</span></td>
            <td><span class="sa-tag" :class="a.is_active ? 'ok' : 'warn'">{{ a.is_active ? 'Active' : 'Suspended' }}</span></td>
            <td>
              <div class="sa-table-row-actions">
                <button class="sa-btn" :disabled="saving || a.is_primary_admin" @click="toggle(a)">{{ a.is_active ? 'Suspend' : 'Restore' }}</button>
                <button class="sa-btn" :disabled="saving" @click="reset(a.id)">Reset password</button>
                <button class="sa-btn" :disabled="saving" @click="primary(a)">Make primary</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
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

const create = () => run(async () => {
  await createWorkspaceAdmin(createWorkspaceId.value, email.value);
  email.value = "";
  await load();
}, "Workspace Admin created and setup email sent.");

const toggle = (admin: SuperWorkspaceAdmin) => run(async () => {
  await setWorkspaceAdminStatus(admin.id, !admin.is_active);
  await load();
}, "Workspace Admin status updated.");

const reset = (id: string) => run(async () => {
  await sendWorkspaceAdminReset(id);
}, "Password reset email sent.");

const primary = (admin: SuperWorkspaceAdmin) => {
  if (!confirm("Reassign Primary Workspace Admin? This Super Admin-only action changes peer-management authority.")) return;
  void run(async () => {
    await setPrimaryWorkspaceAdmin(admin.workspace_id, admin.id);
    await load();
  }, "Primary Workspace Admin reassigned.");
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
