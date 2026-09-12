<template>
  <main class="page">
    <RouterLink to="/super-admin">Back</RouterLink>
    <h1>Workspace Admins</h1>
    <div class="card">
      <input v-model="search" placeholder="Search email" />
      <select v-model="workspaceId">
        <option value="all">All workspaces</option>
        <option v-for="w in workspaces" :key="w.id" :value="w.id">{{ w.name }}</option>
      </select>
      <button :disabled="loading || saving" @click="load">Search</button>
    </div>
    <div class="card">
      <h2>Create Workspace Admin</h2>
      <form @submit.prevent="create">
        <select v-model="createWorkspaceId" required>
          <option value="" disabled>Select workspace</option>
          <option v-for="w in workspaces" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
        <input v-model="email" type="email" required />
        <button :disabled="saving">Create and send setup</button>
      </form>
    </div>
    <p v-if="message" class="notice" role="status">{{ message }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <table>
      <thead><tr><th>Email</th><th>Workspace</th><th>Primary</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        <tr v-for="a in admins" :key="a.id">
          <td>{{ a.auth_email }}</td>
          <td>{{ a.workspace_name }}</td>
          <td>{{ a.is_primary_admin ? 'Yes' : 'No' }}</td>
          <td>{{ a.is_active ? 'Active' : 'Suspended' }}</td>
          <td>
            <button :disabled="saving || a.is_primary_admin" @click="toggle(a)">{{ a.is_active ? 'Suspend' : 'Restore' }}</button>
            <button :disabled="saving" @click="reset(a.id)">Reset password</button>
            <button :disabled="saving" @click="primary(a)">Make primary</button>
          </td>
        </tr>
      </tbody>
    </table>
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
