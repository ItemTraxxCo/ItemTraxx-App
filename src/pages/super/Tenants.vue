<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin">Return to Super Admin</RouterLink>
      <RouterLink class="button-link" to="/super-admin/admins">Tenant Admins</RouterLink>
      <RouterLink class="button-link" to="/super-admin/gear">All Gear</RouterLink>
      <RouterLink class="button-link" to="/super-admin/students">All Students</RouterLink>
      <RouterLink class="button-link" to="/super-admin/logs">All Logs</RouterLink>
      <RouterLink class="button-link" to="/super-admin/broadcasts">Broadcasts</RouterLink>
    </div>

    <h1>Tenant Management</h1>
    <p>Create and manage tenant lifecycle.</p>

    <div class="card">
      <h2>Create Tenant</h2>
      <form class="form" @submit.prevent="handleCreate">
        <label>
          Name
          <input v-model="createName" type="text" placeholder="Tenant name" />
        </label>
        <label>
          Access Code
          <input v-model="createAccessCode" type="text" placeholder="Access code" />
        </label>
        <label>
          Tenant Admin Email
          <input v-model="createAuthEmail" type="email" placeholder="admin@tenant.com" />
        </label>
        <label>
          Tenant Admin Password
          <input
            v-model="createPassword"
            type="password"
            placeholder="Minimum 8 characters"
            autocomplete="off"
          />
        </label>
        <label>
          Status
          <select v-model="createStatusLabel">
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        </label>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isSaving">Create Tenant</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>Tenant List</h2>
      <div class="input-row">
        <input v-model="search" type="text" placeholder="Search by tenant name or access code" />
        <button type="button" @click="loadTenants">Search</button>
      </div>
      <label>
        Filter status
        <select v-model="statusFilterLabel" @change="loadTenants">
          <option value="all">all</option>
          <option value="active">active</option>
          <option value="disabled">disabled</option>
        </select>
      </label>

      <p v-if="isLoading" class="muted">Loading tenants...</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Access Code</th>
            <th>Status</th>
            <th>Primary Admin</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tenant in tenants" :key="tenant.id">
            <td>{{ tenant.name }}</td>
            <td>{{ tenant.access_code }}</td>
            <td>{{ toTenantStatusLabel(tenant.status) }}</td>
            <td>{{ tenant.primary_admin_email || "-" }}</td>
            <td>{{ formatDate(tenant.created_at) }}</td>
            <td class="actions-cell">
              <button type="button" @click="openEditModal(tenant)">Edit</button>
              <button type="button" :disabled="isSaving" @click="openStatusModal(tenant)">
                {{ tenant.status === "active" ? "Disable" : "Reactivate" }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="editModalVisible" class="modal-backdrop" @click.self="closeEditModal">
      <div class="modal">
        <h2>Edit Tenant</h2>
        <form class="form" @submit.prevent="saveEdit">
          <label>
            Name
            <input v-model="editName" type="text" placeholder="Tenant name" />
          </label>
          <label>
            Access Code
            <input v-model="editAccessCode" type="text" placeholder="Access code" />
          </label>
          <div class="form-actions">
            <button type="button" :disabled="isSaving" @click="sendEditTenantReset">
              Send Reset Link
            </button>
            <button type="submit" class="button-primary" :disabled="isSaving">Save</button>
            <button type="button" @click="closeEditModal">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>

    <StepUpModal
      :visible="statusModalVisible"
      :title="statusModalTitle"
      :message="statusModalMessage"
      :confirm-label="statusModalConfirmLabel"
      @cancel="closeStatusModal"
      @confirm="confirmStatusChange"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import StepUpModal from "../../components/StepUpModal.vue";
import {
  createTenant,
  fromTenantStatusLabel,
  listTenants,
  sendPrimaryAdminReset,
  setTenantStatus,
  toTenantStatusLabel,
  updateTenant,
  type SuperTenant,
} from "../../services/superTenantService";

const tenants = ref<SuperTenant[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const search = ref("");
const statusFilterLabel = ref<"all" | "active" | "disabled">("all");
const createName = ref("");
const createAccessCode = ref("");
const createAuthEmail = ref("");
const createPassword = ref("");
const createStatusLabel = ref<"active" | "disabled">("active");
const editTenantId = ref<string | null>(null);
const editModalVisible = ref(false);
const editName = ref("");
const editAccessCode = ref("");
const toastTitle = ref("");
const toastMessage = ref("");
const statusModalVisible = ref(false);
const statusModalTitle = ref("");
const statusModalMessage = ref("");
const statusModalConfirmLabel = ref("Confirm");
const statusTarget = ref<{ id: string; name: string; nextStatus: "active" | "suspended" } | null>(null);
let toastTimer: number | null = null;

const showToast = (title: string, message: string) => {
  toastTitle.value = title;
  toastMessage.value = message;
  if (toastTimer) window.clearTimeout(toastTimer);
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
  isLoading.value = true;
  error.value = "";
  try {
    const status =
      statusFilterLabel.value === "all"
        ? "all"
        : fromTenantStatusLabel(statusFilterLabel.value);
    tenants.value = await listTenants(search.value.trim(), status);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load tenants.";
  } finally {
    isLoading.value = false;
  }
};

const handleCreate = async () => {
  if (
    !createName.value.trim() ||
    !createAccessCode.value.trim() ||
    !createAuthEmail.value.trim() ||
    !createPassword.value
  ) {
    showToast(
      "Invalid input",
      "Enter tenant name, access code, tenant admin email, and password."
    );
    return;
  }
  if (createPassword.value.length < 8) {
    showToast("Invalid input", "Tenant admin password must be at least 8 characters.");
    return;
  }
  isSaving.value = true;
  try {
    const created = await createTenant({
      name: createName.value.trim(),
      access_code: createAccessCode.value.trim(),
      auth_email: createAuthEmail.value.trim().toLowerCase(),
      password: createPassword.value,
      status: fromTenantStatusLabel(createStatusLabel.value),
    });
    tenants.value = [created, ...tenants.value];
    createName.value = "";
    createAccessCode.value = "";
    createAuthEmail.value = "";
    createPassword.value = "";
    createStatusLabel.value = "active";
    showToast("Tenant created", "Tenant and tenant admin login were created successfully.");
  } catch (err) {
    showToast("Create failed", err instanceof Error ? err.message : "Unable to create tenant.");
  } finally {
    isSaving.value = false;
  }
};

const openEditModal = (tenant: SuperTenant) => {
  editTenantId.value = tenant.id;
  editName.value = tenant.name;
  editAccessCode.value = tenant.access_code;
  editModalVisible.value = true;
};

const closeEditModal = () => {
  editModalVisible.value = false;
  editTenantId.value = null;
  editName.value = "";
  editAccessCode.value = "";
};

const saveEdit = async () => {
  if (!editTenantId.value) return;
  if (!editName.value.trim() || !editAccessCode.value.trim()) {
    showToast("Invalid input", "Enter tenant name and access code.");
    return;
  }

  isSaving.value = true;
  try {
    const updated = await updateTenant({
      id: editTenantId.value,
      name: editName.value.trim(),
      access_code: editAccessCode.value.trim(),
    });
    tenants.value = tenants.value.map((tenant) =>
      tenant.id === updated.id ? updated : tenant
    );
    closeEditModal();
    showToast("Tenant updated", "Tenant details were updated.");
  } catch (err) {
    showToast("Update failed", err instanceof Error ? err.message : "Unable to update tenant.");
  } finally {
    isSaving.value = false;
  }
};

const sendEditTenantReset = async () => {
  if (!editTenantId.value) return;
  isSaving.value = true;
  try {
    const data = await sendPrimaryAdminReset({ tenant_id: editTenantId.value });
    showToast("Reset sent", `Password reset sent to ${data.auth_email}.`);
  } catch (err) {
    showToast(
      "Reset failed",
      err instanceof Error ? err.message : "Unable to send reset link."
    );
  } finally {
    isSaving.value = false;
  }
};

const openStatusModal = (tenant: SuperTenant) => {
  const nextStatus = tenant.status === "active" ? "suspended" : "active";
  statusTarget.value = { id: tenant.id, name: tenant.name, nextStatus };
  statusModalTitle.value =
    nextStatus === "suspended" ? "Disable Tenant" : "Reactivate Tenant";
  statusModalMessage.value = `Type CONFIRM and enter your super admin password to ${
    nextStatus === "suspended" ? "disable" : "reactivate"
  } ${tenant.name}.`;
  statusModalConfirmLabel.value =
    nextStatus === "suspended" ? "Disable" : "Reactivate";
  statusModalVisible.value = true;
};

const closeStatusModal = () => {
  statusModalVisible.value = false;
  statusTarget.value = null;
};

const confirmStatusChange = async (payload: {
  superPassword: string;
  confirmPhrase: string;
}) => {
  if (!statusTarget.value) return;
  isSaving.value = true;
  try {
    await setTenantStatus({
      id: statusTarget.value.id,
      status: statusTarget.value.nextStatus,
      super_password: payload.superPassword,
      confirm_phrase: payload.confirmPhrase,
    });
    await loadTenants();
    showToast(
      statusTarget.value.nextStatus === "suspended"
        ? "Tenant disabled"
        : "Tenant reactivated",
      `${statusTarget.value.name} is now ${
        statusTarget.value.nextStatus === "suspended" ? "disabled" : "active"
      }.`
    );
    closeStatusModal();
  } catch (err) {
    showToast(
      "Status update failed",
      err instanceof Error ? err.message : "Unable to update tenant status."
    );
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  void loadTenants();
});
</script>

<style scoped>
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

.actions-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
