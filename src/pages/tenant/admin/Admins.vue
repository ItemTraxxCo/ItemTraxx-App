<template>
  <div class="page admin-shell">
    <div class="admin-hero">
      <div class="admin-toolbar">
        <div class="page-nav-left">
          <RouterLink class="button-link" to="/tenant/admin">Return to admin panel</RouterLink>
          <RouterLink class="button-link" to="/tenant/admin/settings">Settings</RouterLink>
        </div>
        <div v-if="canManageAdmins" class="muted">Primary admin controls enabled</div>
        <div v-else class="muted">Read-only access</div>
      </div>
      <h1>Admin Access</h1>
      <p class="admin-hero-copy">
        Manage tenant admin accounts for this tenant. Only primary admins can invite new admins,
        reset access, and disable or re-enable existing admin accounts.
      </p>
      <div class="admin-summary-grid">
        <div class="admin-summary-card">
          <strong>{{ admins.length }}</strong>
          <span>Total admins</span>
        </div>
        <div class="admin-summary-card">
          <strong>{{ activeAdminCount }}</strong>
          <span>Active admins</span>
        </div>
        <div class="admin-summary-card">
          <strong>{{ disabledAdminCount }}</strong>
          <span>Disabled admins</span>
        </div>
        <div class="admin-summary-card">
          <strong>{{ primaryAdminEmail }}</strong>
          <span>Primary admin</span>
        </div>
      </div>
    </div>

    <div v-if="!canManageAdmins" class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Primary Admin Only</h2>
          <p class="admin-section-copy">
            You can view the tenant admin roster, but only the primary admin can create or change tenant admin accounts.
          </p>
        </div>
      </div>
    </div>

    <div v-if="canManageAdmins" class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Create Tenant Admin</h2>
          <p class="admin-section-copy">
            Invite a new admin for this tenant by email. They will receive a setup link with further instructions.
          </p>
        </div>
      </div>
      <form class="form" @submit.prevent="handleCreate">
        <label>
          Email
          <input v-model="createEmail" type="email" placeholder="admin@tenant.com" />
        </label>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isSaving">Invite admin</button>
        </div>
      </form>
    </div>

    <div class="card admin-section-card">
      <div class="admin-section-header">
        <div>
          <h2>Tenant Admins</h2>
          <p class="admin-section-copy">
            Review tenant admin accounts, primary admin status, and current account access.
          </p>
        </div>
      </div>
      <p v-if="isLoading" class="muted">Loading tenant admins...</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Created</th>
              <th>Role</th>
              <th v-if="canManageAdmins">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="admin in admins" :key="admin.id">
              <td>
                <div class="admin-email-cell">
                  <span>{{ admin.auth_email }}</span>
                  <span v-if="admin.is_primary_admin" class="status-pill is-primary">Primary admin</span>
                </div>
              </td>
              <td>
                <span class="status-pill" :class="admin.is_active ? 'is-active' : 'is-inactive'">
                  {{ admin.is_active ? 'Active' : 'Disabled' }}
                </span>
              </td>
              <td>{{ formatDate(admin.created_at) }}</td>
              <td>{{ admin.is_primary_admin ? 'Primary' : 'Tenant admin' }}</td>
              <td v-if="canManageAdmins">
                <div v-if="!admin.is_primary_admin" class="row-actions">
                  <button type="button" @click="openEditModal(admin)">Manage</button>
                </div>
                <span v-else class="muted">Managed by super admin</span>
              </td>
            </tr>
            <tr v-if="admins.length === 0">
              <td :colspan="canManageAdmins ? 5 : 4" class="muted">No tenant admins found.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="editModalVisible && editTarget" class="modal-backdrop" @click.self="closeEditModal">
      <div class="modal admin-manage-modal">
        <h3>Manage Tenant Admin</h3>
        <p class="muted">Update the admin email, send a reset link, or change account status.</p>
        <form class="form" @submit.prevent="saveEditEmail">
          <label>
            Admin email
            <input v-model="editEmail" type="email" placeholder="admin@tenant.com" />
          </label>
          <div class="form-actions">
            <button type="submit" class="button-primary" :disabled="isSaving">Save Email</button>
            <button type="button" :disabled="isSaving" @click="sendEditReset">Send Reset Link</button>
            <button type="button" :disabled="isSaving" @click="toggleEditStatus">
              {{ editTarget.is_active ? 'Disable' : 'Enable' }}
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
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { toUserFacingErrorMessage } from "../../../services/appErrors";
import {
  createTenantManagedAdmin,
  listTenantManagedAdmins,
  sendTenantManagedAdminReset,
  setTenantManagedAdminStatus,
  updateTenantManagedAdminEmail,
  type TenantManagedAdmin,
} from "../../../services/tenantAdminManageService";

const admins = ref<TenantManagedAdmin[]>([]);
const canManageAdmins = ref(false);
const primaryAdminProfileId = ref<string | null>(null);
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const createEmail = ref("");
const editModalVisible = ref(false);
const editTarget = ref<TenantManagedAdmin | null>(null);
const editEmail = ref("");
const toastTitle = ref("");
const toastMessage = ref("");
let toastTimer: number | null = null;

const activeAdminCount = computed(() => admins.value.filter((item) => item.is_active).length);
const disabledAdminCount = computed(() => admins.value.filter((item) => !item.is_active).length);
const primaryAdminEmail = computed(
  () => admins.value.find((item) => item.is_primary_admin)?.auth_email ?? "Unavailable"
);

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

const loadAdmins = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    const data = await listTenantManagedAdmins();
    admins.value = data.admins;
    canManageAdmins.value = data.can_manage_admins;
    primaryAdminProfileId.value = data.primary_admin_profile_id;
  } catch (err) {
    error.value = toUserFacingErrorMessage(err, "Unable to load tenant admins.");
  } finally {
    isLoading.value = false;
  }
};

const handleCreate = async () => {
  const authEmail = createEmail.value.trim();
  if (!authEmail) {
    showToast("Invalid input", "Enter an admin email to continue.");
    return;
  }
  isSaving.value = true;
  try {
    await createTenantManagedAdmin({ auth_email: authEmail });
    createEmail.value = "";
    showToast("Admin invited", "Password setup email sent to the new tenant admin.");
    await loadAdmins();
  } catch (err) {
    showToast("Create failed", toUserFacingErrorMessage(err, "Unable to invite tenant admin."));
  } finally {
    isSaving.value = false;
  }
};

const openEditModal = (admin: TenantManagedAdmin) => {
  editTarget.value = admin;
  editEmail.value = admin.auth_email;
  editModalVisible.value = true;
};

const closeEditModal = () => {
  editTarget.value = null;
  editEmail.value = "";
  editModalVisible.value = false;
};

const saveEditEmail = async () => {
  if (!editTarget.value) return;
  const authEmail = editEmail.value.trim();
  if (!authEmail) {
    showToast("Invalid input", "Enter an admin email to continue.");
    return;
  }
  isSaving.value = true;
  try {
    const updated = await updateTenantManagedAdminEmail({ id: editTarget.value.id, auth_email: authEmail });
    admins.value = admins.value.map((item) => (item.id === updated.id ? updated : item));
    showToast("Email updated", "Tenant admin email was updated.");
    closeEditModal();
  } catch (err) {
    showToast("Update failed", toUserFacingErrorMessage(err, "Unable to update tenant admin email."));
  } finally {
    isSaving.value = false;
  }
};

const toggleEditStatus = async () => {
  if (!editTarget.value) return;
  isSaving.value = true;
  try {
    const updated = await setTenantManagedAdminStatus({
      id: editTarget.value.id,
      is_active: !editTarget.value.is_active,
    });
    admins.value = admins.value.map((item) => (item.id === updated.id ? updated : item));
    showToast(updated.is_active ? "Admin enabled" : "Admin disabled", "Tenant admin status updated.");
    closeEditModal();
  } catch (err) {
    showToast("Status update failed", toUserFacingErrorMessage(err, "Unable to update tenant admin status."));
  } finally {
    isSaving.value = false;
  }
};

const sendEditReset = async () => {
  if (!editTarget.value) return;
  isSaving.value = true;
  try {
    await sendTenantManagedAdminReset({ auth_email: editTarget.value.auth_email });
    showToast("Reset sent", "Password reset email sent to the tenant admin.");
    closeEditModal();
  } catch (err) {
    showToast("Reset failed", toUserFacingErrorMessage(err, "Unable to send reset email."));
  } finally {
    isSaving.value = false;
  }
};

onMounted(loadAdmins);

onUnmounted(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
});
</script>

<style scoped>
.admin-email-cell {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.18rem 0.58rem;
  border-radius: 999px;
  border: 1px solid rgba(122, 140, 168, 0.26);
  background: rgba(21, 28, 40, 0.62);
  font-size: 0.82rem;
  font-weight: 700;
}

.status-pill.is-primary {
  color: rgb(93, 229, 214);
  border-color: rgba(25, 194, 168, 0.34);
  background: rgba(25, 194, 168, 0.12);
}

.status-pill.is-active {
  color: rgb(93, 229, 214);
}

.status-pill.is-inactive {
  color: rgba(238, 186, 186, 0.92);
  border-color: rgba(186, 98, 98, 0.32);
  background: rgba(128, 44, 44, 0.12);
}

.row-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.admin-manage-modal {
  max-width: 34rem;
}
</style>
