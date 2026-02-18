<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin">Return to Super Admin</RouterLink>
      <RouterLink class="button-link" to="/super-admin/tenants">Tenants</RouterLink>
      <RouterLink class="button-link" to="/super-admin/gear">All Gear</RouterLink>
      <RouterLink class="button-link" to="/super-admin/students">All Students</RouterLink>
      <RouterLink class="button-link" to="/super-admin/logs">All Logs</RouterLink>
      <RouterLink class="button-link" to="/super-admin/broadcasts">Broadcasts</RouterLink>
    </div>

    <h1>Tenant Admin Management</h1>
    <p>Create and manage tenant admins.</p>

    <div class="card">
      <h2>Create Tenant Admin</h2>
      <form class="form" @submit.prevent="handleCreate">
        <label>
          Tenant
          <select v-model="createTenantId">
            <option value="">Select tenant</option>
            <option v-for="tenant in tenants" :key="tenant.id" :value="tenant.id">
              {{ tenant.name }} ({{ tenant.status === "suspended" ? "disabled" : "active" }})
            </option>
          </select>
        </label>
        <label>
          Email
          <input v-model="createEmail" type="email" placeholder="admin@tenant.com" />
        </label>
        <label>
          Password
          <input v-model="createPassword" type="password" placeholder="Temporary password" />
        </label>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isSaving">Create Tenant Admin</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>Tenant Admin List</h2>
      <div class="input-row">
        <input v-model="search" type="text" placeholder="Search by email" />
        <button type="button" @click="loadAdmins">Search</button>
      </div>
      <label>
        Filter tenant
        <select v-model="tenantFilter" @change="loadAdmins">
          <option value="all">all</option>
          <option v-for="tenant in tenants" :key="tenant.id" :value="tenant.id">
            {{ tenant.name }}
          </option>
        </select>
      </label>

      <p v-if="isLoading" class="muted">Loading tenant admins...</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Tenant</th>
            <th>Status</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="admin in admins" :key="admin.id">
            <td>{{ admin.auth_email }}</td>
            <td>{{ admin.tenant_name || admin.tenant_id }}</td>
            <td>{{ admin.is_active ? "active" : "disabled" }}</td>
            <td>{{ formatDate(admin.created_at) }}</td>
            <td>
              <button type="button" @click="toggleAdminStatus(admin)">
                {{ admin.is_active ? "Disable" : "Enable" }}
              </button>
              <button type="button" @click="sendReset(admin.auth_email)">Send Reset</button>
              <button type="button" @click="setAsPrimary(admin)">Set Primary</button>
            </td>
          </tr>
          <tr v-if="admins.length === 0">
            <td colspan="5" class="muted">No tenant admins found.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  createTenantAdmin,
  listTenantAdmins,
  sendTenantAdminReset,
  setTenantAdminStatus,
  type SuperTenantAdmin,
} from "../../services/superAdminService";
import { listTenants, setPrimaryAdmin, type SuperTenant } from "../../services/superTenantService";

const tenants = ref<SuperTenant[]>([]);
const admins = ref<SuperTenantAdmin[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const search = ref("");
const tenantFilter = ref("all");
const createTenantId = ref("");
const createEmail = ref("");
const createPassword = ref("");
const toastTitle = ref("");
const toastMessage = ref("");
let toastTimer: number | null = null;

const showToast = (title: string, message: string) => {
  toastTitle.value = title;
  toastMessage.value = message;
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastTitle.value = "";
    toastMessage.value = "";
    toastTimer = null;
  }, 4000);
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
};

const loadTenants = async () => {
  try {
    tenants.value = await listTenants("", "all");
  } catch {
    // Keep page usable even if tenant list fails.
  }
};

const loadAdmins = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    admins.value = await listTenantAdmins(search.value.trim(), tenantFilter.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load tenant admins.";
  } finally {
    isLoading.value = false;
  }
};

const handleCreate = async () => {
  if (!createTenantId.value || !createEmail.value.trim() || !createPassword.value.trim()) {
    showToast("Invalid input", "Select tenant, email, and password.");
    return;
  }

  isSaving.value = true;
  try {
    const created = await createTenantAdmin({
      tenant_id: createTenantId.value,
      auth_email: createEmail.value.trim(),
      password: createPassword.value,
    });
    admins.value = [created, ...admins.value];
    createTenantId.value = "";
    createEmail.value = "";
    createPassword.value = "";
    showToast("Tenant admin created", "Tenant admin account was created.");
  } catch (err) {
    showToast("Create failed", err instanceof Error ? err.message : "Unable to create tenant admin.");
  } finally {
    isSaving.value = false;
  }
};

const toggleAdminStatus = async (admin: SuperTenantAdmin) => {
  const nextStatus = !admin.is_active;
  const confirmed = window.confirm(
    `${nextStatus ? "Enable" : "Disable"} tenant admin ${admin.auth_email}?`
  );
  if (!confirmed) return;

  isSaving.value = true;
  try {
    const updated = await setTenantAdminStatus({
      id: admin.id,
      is_active: nextStatus,
    });
    admins.value = admins.value.map((item) =>
      item.id === updated.id ? updated : item
    );
    showToast(
      nextStatus ? "Tenant admin enabled" : "Tenant admin disabled",
      `${admin.auth_email} is now ${nextStatus ? "active" : "disabled"}.`
    );
  } catch (err) {
    showToast("Status update failed", err instanceof Error ? err.message : "Unable to update admin status.");
  } finally {
    isSaving.value = false;
  }
};

const sendReset = async (authEmail: string) => {
  isSaving.value = true;
  try {
    await sendTenantAdminReset({ auth_email: authEmail });
    showToast("Reset sent", `Password reset flow triggered for ${authEmail}.`);
  } catch (err) {
    showToast("Reset failed", err instanceof Error ? err.message : "Unable to send reset.");
  } finally {
    isSaving.value = false;
  }
};


const setAsPrimary = async (admin: SuperTenantAdmin) => {
  if (!admin.tenant_id || !admin.id) return;
  isSaving.value = true;
  try {
    await setPrimaryAdmin({ tenant_id: admin.tenant_id, profile_id: admin.id });
    showToast("Primary admin updated", `${admin.auth_email} is now the primary admin.`);
  } catch (err) {
    showToast("Update failed", err instanceof Error ? err.message : "Unable to set primary admin.");
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  void loadTenants();
  void loadAdmins();
});
</script>
