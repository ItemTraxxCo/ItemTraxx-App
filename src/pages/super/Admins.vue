<template>
  <div class="page">
    <div class="super-page-header">
      <div>
        <div class="page-nav-left">
          <RouterLink class="button-link" to="/super-admin">Control Center</RouterLink>
          <RouterLink class="button-link" to="/super-admin/tenants">Tenants</RouterLink>
          <RouterLink class="button-link" to="/super-admin/districts">Districts</RouterLink>
        </div>
        <h1>Admin Management</h1>
        <p>Manage tenant and district admins from one place, with scope-aware filters and actions.</p>
      </div>
      <div class="page-nav-left super-page-links">
        <RouterLink class="button-link" to="/super-admin/gear">All Items</RouterLink>
        <RouterLink class="button-link" to="/super-admin/students">All Students</RouterLink>
        <RouterLink class="button-link" to="/super-admin/logs">All Logs</RouterLink>
      </div>
    </div>

    <div class="admin-grid admin-stats">
      <div class="stat-card">
        <h3>Total admins</h3>
        <p class="stat-value">{{ admins.length }}</p>
      </div>
      <div class="stat-card">
        <h3>Tenant admins</h3>
        <p class="stat-value">{{ tenantAdminCount }}</p>
      </div>
      <div class="stat-card">
        <h3>District admins</h3>
        <p class="stat-value">{{ districtAdminCount }}</p>
      </div>
      <div class="stat-card">
        <h3>Disabled</h3>
        <p class="stat-value">{{ disabledAdminCount }}</p>
      </div>
    </div>

    <div class="section-grid">
      <div class="card section-card">
        <div class="section-heading">
          <h2>Create Admin</h2>
          <p class="muted">Pick a scope first, then target the tenant or district directly.</p>
        </div>
      <form class="form" @submit.prevent="handleCreate">
        <label>
          Admin Scope
          <select v-model="adminScope">
            <option value="tenant">tenant</option>
            <option value="district">district</option>
          </select>
        </label>
        <label>
          {{ adminScope === "tenant" ? "Tenant" : "District" }}
          <select v-model="createTargetId">
            <option value="">Select {{ adminScope }}</option>
            <option v-for="target in targets" :key="target.id" :value="target.id">
              {{ formatTargetLabel(target) }}
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

      <div class="card section-card">
        <div class="section-heading">
          <h2>Admin List</h2>
          <p class="muted">Use the scope filter to switch between tenant and district operators.</p>
        </div>
        <div class="filter-toolbar">
          <div class="input-row">
            <input v-model="search" type="text" placeholder="Search by email" />
            <button type="button" @click="loadAdmins">Search</button>
          </div>
          <label class="filter-select">
            Scope
            <select v-model="adminScope">
              <option value="tenant">tenant</option>
              <option value="district">district</option>
            </select>
          </label>
          <label v-if="adminScope === 'tenant'" class="filter-select">
            Filter tenant
            <select v-model="tenantFilter" @change="loadAdmins">
              <option value="all">all</option>
              <option v-for="tenant in tenants" :key="tenant.id" :value="tenant.id">
                {{ tenant.name }}
              </option>
            </select>
          </label>
        </div>

        <p v-if="isLoading" class="muted">Loading tenant admins...</p>
        <p v-else-if="error" class="error">{{ error }}</p>
        <table v-else class="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>{{ adminScope === "tenant" ? "Tenant" : "District" }}</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="admin in admins" :key="admin.id">
              <td>{{ admin.auth_email }}</td>
              <td>{{ adminScope === "tenant" ? admin.tenant_name || admin.tenant_id : admin.district_name || admin.district_id }}</td>
              <td>{{ admin.is_active ? "active" : "disabled" }}</td>
              <td>{{ formatDate(admin.created_at) }}</td>
              <td class="actions-cell">
                <button type="button" @click="openEditModal(admin)">Edit</button>
              </td>
            </tr>
            <tr v-if="admins.length === 0">
              <td colspan="5" class="muted">No tenant admins found.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="editModalVisible" class="modal-backdrop" @click.self="closeEditModal">
      <div class="modal">
        <h2>Edit Tenant Admin</h2>
        <form class="form" @submit.prevent="saveEditEmail">
          <label>
            Email
            <input v-model="editEmail" type="email" placeholder="admin@tenant.com" />
          </label>
          <div class="form-actions">
            <button type="submit" class="button-primary" :disabled="isSaving">Save Email</button>
            <button type="button" :disabled="isSaving" @click="sendEditReset">Send Reset Link</button>
            <button
              v-if="adminScope === 'tenant'"
              type="button"
              :disabled="isSaving"
              @click="setEditAsPrimary"
            >
              Set Primary
            </button>
            <button type="button" :disabled="isSaving" @click="toggleEditStatus">
              {{ editTarget?.is_active ? "Disable" : "Enable" }}
            </button>
            <button type="button" @click="closeEditModal">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  createTenantAdmin,
  listTenantAdmins,
  sendTenantAdminReset,
  setTenantAdminStatus,
  updateTenantAdminEmail,
  type SuperTenantAdmin,
} from "../../services/superAdminService";
import {
  listDistricts,
  listTenants,
  setPrimaryAdmin,
  type SuperDistrict,
  type SuperTenant,
} from "../../services/superTenantService";

const tenants = ref<SuperTenant[]>([]);
const districts = ref<SuperDistrict[]>([]);
const admins = ref<SuperTenantAdmin[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const search = ref("");
const tenantFilter = ref("all");
const adminScope = ref<"tenant" | "district">("tenant");
const createTargetId = ref("");
const createEmail = ref("");
const createPassword = ref("");
const toastTitle = ref("");
const toastMessage = ref("");
const editModalVisible = ref(false);
const editTarget = ref<SuperTenantAdmin | null>(null);
const editEmail = ref("");
const targets = computed<Array<SuperTenant | SuperDistrict>>(() =>
  adminScope.value === "tenant" ? tenants.value : districts.value
);
const tenantAdminCount = computed(() =>
  admins.value.filter((admin) => !!admin.tenant_id).length
);
const districtAdminCount = computed(() =>
  admins.value.filter((admin) => !!admin.district_id).length
);
const disabledAdminCount = computed(() =>
  admins.value.filter((admin) => !admin.is_active).length
);
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

const formatTargetLabel = (target: SuperTenant | SuperDistrict) => {
  if (adminScope.value === "tenant") {
    const tenant = target as SuperTenant;
    return `${tenant.name} (${tenant.status === "suspended" ? "disabled" : tenant.status})`;
  }
  const district = target as SuperDistrict;
  return `${district.name} (${district.slug || "-"})`;
};

const loadTenants = async () => {
  try {
    tenants.value = await listTenants("", "all");
  } catch {
    // Keep page usable even if tenant list fails.
  }
};

const loadDistricts = async () => {
  try {
    districts.value = await listDistricts("");
  } catch {
    // Keep page usable even if district list fails.
  }
};

const loadAdmins = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    admins.value = await listTenantAdmins(
      search.value.trim(),
      adminScope.value === "tenant" ? tenantFilter.value : "all",
      adminScope.value
    );
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load admins.";
  } finally {
    isLoading.value = false;
  }
};

const handleCreate = async () => {
  if (!createTargetId.value || !createEmail.value.trim() || !createPassword.value.trim()) {
    showToast("Invalid input", `Select ${adminScope.value}, email, and password.`);
    return;
  }

  isSaving.value = true;
  try {
    const created = await createTenantAdmin({
      ...(adminScope.value === "tenant"
        ? { tenant_id: createTargetId.value }
        : { district_id: createTargetId.value }),
      auth_email: createEmail.value.trim(),
      password: createPassword.value,
      admin_scope: adminScope.value,
    });
    admins.value = [created, ...admins.value];
    createTargetId.value = "";
    createEmail.value = "";
    createPassword.value = "";
    showToast("Admin created", `${adminScope.value} admin account was created.`);
  } catch (err) {
    showToast("Create failed", err instanceof Error ? err.message : "Unable to create admin.");
  } finally {
    isSaving.value = false;
  }
};

const openEditModal = (admin: SuperTenantAdmin) => {
  editTarget.value = admin;
  editEmail.value = admin.auth_email;
  editModalVisible.value = true;
};

const closeEditModal = () => {
  editModalVisible.value = false;
  editTarget.value = null;
  editEmail.value = "";
};

const toggleEditStatus = async () => {
  if (!editTarget.value) return;
  const current = editTarget.value;
  const nextStatus = !current.is_active;
  const confirmed = window.confirm(
    `${nextStatus ? "Enable" : "Disable"} ${adminScope.value} admin ${current.auth_email}?`
  );
  if (!confirmed) return;

  isSaving.value = true;
  try {
    const updated = await setTenantAdminStatus({
      id: current.id,
      is_active: nextStatus,
      admin_scope: adminScope.value,
    });
    admins.value = admins.value.map((item) => (item.id === updated.id ? updated : item));
    editTarget.value = updated;
    editEmail.value = updated.auth_email;
    showToast(
      nextStatus ? "Admin enabled" : "Admin disabled",
      `${updated.auth_email} is now ${nextStatus ? "active" : "disabled"}.`
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
    await sendTenantAdminReset({ auth_email: authEmail, admin_scope: adminScope.value });
    showToast("Reset sent", `Password reset flow triggered for ${authEmail}.`);
  } catch (err) {
    showToast("Reset failed", err instanceof Error ? err.message : "Unable to send reset.");
  } finally {
    isSaving.value = false;
  }
};

const sendEditReset = async () => {
  if (!editTarget.value) return;
  await sendReset(editTarget.value.auth_email);
};

const saveEditEmail = async () => {
  if (!editTarget.value) return;
  const nextEmail = editEmail.value.trim().toLowerCase();
  if (!nextEmail) {
    showToast("Invalid input", "Enter an email address.");
    return;
  }
  isSaving.value = true;
  try {
    const updated = await updateTenantAdminEmail({
      id: editTarget.value.id,
      auth_email: nextEmail,
      admin_scope: adminScope.value,
    });
    admins.value = admins.value.map((item) => (item.id === updated.id ? updated : item));
    editTarget.value = updated;
    editEmail.value = updated.auth_email;
    showToast("Admin updated", "Admin email was updated.");
  } catch (err) {
    showToast("Update failed", err instanceof Error ? err.message : "Unable to update admin.");
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

const setEditAsPrimary = async () => {
  if (!editTarget.value) return;
  await setAsPrimary(editTarget.value);
};

onMounted(() => {
  void loadTenants();
  void loadDistricts();
  void loadAdmins();
});

watch(adminScope, () => {
  tenantFilter.value = "all";
  createTargetId.value = "";
  void loadAdmins();
});
</script>

<style scoped>
.super-page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}

.super-page-links {
  justify-content: flex-end;
}

.admin-stats {
  margin-top: 1rem;
}

.section-grid {
  display: grid;
  grid-template-columns: minmax(300px, 340px) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.section-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section-heading h2 {
  margin: 0;
}

.section-heading p {
  margin: 0.35rem 0 0;
}

.filter-toolbar {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  align-items: end;
}

.filter-select {
  min-width: 180px;
}

.actions-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(5, 10, 20, 0.52);
  display: grid;
  place-items: center;
  z-index: 80;
  padding: 1rem;
}

.modal {
  width: min(520px, 100%);
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.24);
  padding: 1rem;
}

.modal .form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

@media (max-width: 900px) {
  .super-page-header {
    flex-direction: column;
  }

  .super-page-links {
    justify-content: flex-start;
  }

  .section-grid {
    grid-template-columns: 1fr;
  }
}
</style>
