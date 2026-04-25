<template>
  <div class="page">
    <div class="super-page-header">
      <div>
        <div class="page-nav-left">
          <RouterLink class="button-link" to="/super-admin">Control Center</RouterLink>
          <RouterLink class="button-link" to="/super-admin/support-requests">Support Requests</RouterLink>
          <RouterLink class="button-link" to="/super-admin/admins">Tenant Admins</RouterLink>
        </div>
        <h1>Super Admins</h1>
        <p>Manage privileged operator accounts with step-up enforcement and last-admin safeguards.</p>
      </div>
    </div>

    <div class="admin-grid admin-stats">
      <div class="stat-card">
        <h3>Total super admins</h3>
        <p class="stat-value">{{ admins.length }}</p>
      </div>
      <div class="stat-card">
        <h3>Active</h3>
        <p class="stat-value">{{ activeAdminCount }}</p>
      </div>
      <div class="stat-card">
        <h3>Disabled</h3>
        <p class="stat-value">{{ disabledAdminCount }}</p>
      </div>
    </div>

    <div class="section-grid">
      <div class="card section-card">
        <div class="section-heading">
          <h2>Create Super Admin</h2>
          <p class="muted">Creates a new privileged operator account with immediate access after super auth.</p>
        </div>
        <form class="form" @submit.prevent="handleCreate">
          <label>
            Email
            <input v-model="createEmail" type="email" placeholder="superadmin@itemtraxx.com" />
          </label>
          <label>
            Password
            <input v-model="createPassword" type="password" placeholder="Temporary password" />
          </label>
          <div class="form-actions">
            <button type="submit" class="button-primary" :disabled="isSaving">Create Super Admin</button>
          </div>
        </form>
      </div>

      <div class="card section-card">
        <div class="section-heading">
          <h2>Super Admin List</h2>
          <p class="muted">Every change here is audited and guarded against self-disable and last-admin lockout.</p>
        </div>
        <div class="filter-toolbar">
          <div class="input-row">
            <input v-model="search" type="text" placeholder="Search by email" />
            <button type="button" @click="loadAdmins">Search</button>
          </div>
        </div>

        <p v-if="isLoading" class="muted">Loading super admins...</p>
        <p v-else-if="error" class="error">{{ error }}</p>
        <table v-else class="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="admin in admins" :key="admin.id">
              <td>{{ admin.auth_email }}</td>
              <td>{{ admin.is_active ? "active" : "disabled" }}</td>
              <td>{{ formatDate(admin.created_at) }}</td>
              <td class="actions-cell">
                <button type="button" @click="openEditModal(admin)">Edit</button>
              </td>
            </tr>
            <tr v-if="admins.length === 0">
              <td colspan="4" class="muted">No super admins found.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="editModalVisible" class="modal-backdrop" @click.self="closeEditModal">
      <div class="modal">
        <h2>Edit Super Admin</h2>
        <form class="form" @submit.prevent="saveEditEmail">
          <label>
            Email
            <input v-model="editEmail" type="email" placeholder="superadmin@itemtraxx.com" />
          </label>
          <div class="form-actions">
            <button type="submit" class="button-primary" :disabled="isSaving">Save Email</button>
            <button type="button" :disabled="isSaving" @click="sendEditReset">Send Reset Link</button>
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
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import {
  handleSuperAdminUnauthorized,
  isUnauthorizedError,
} from "../../services/authErrorHandling";
import { toUserFacingErrorMessage } from "../../services/appErrors";
import {
  createSuperAdmin,
  listSuperAdmins,
  sendSuperAdminReset,
  setSuperAdminStatus,
  updateSuperAdminEmail,
  type SuperAdminAccount,
} from "../../services/superAdminService";

const router = useRouter();
const admins = ref<SuperAdminAccount[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const search = ref("");
const createEmail = ref("");
const createPassword = ref("");
const toastTitle = ref("");
const toastMessage = ref("");
const editModalVisible = ref(false);
const editTarget = ref<SuperAdminAccount | null>(null);
const editEmail = ref("");
const activeAdminCount = computed(() => admins.value.filter((admin) => admin.is_active).length);
const disabledAdminCount = computed(() => admins.value.filter((admin) => !admin.is_active).length);
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

const loadAdmins = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    admins.value = await listSuperAdmins(search.value.trim());
  } catch (err) {
    if (isUnauthorizedError(err)) {
      error.value = "Your session expired. Sign in again.";
      await handleSuperAdminUnauthorized(router);
      return;
    }
    error.value = toUserFacingErrorMessage(err, "Unable to load super admins.");
  } finally {
    isLoading.value = false;
  }
};

const handleCreate = async () => {
  if (!createEmail.value.trim() || !createPassword.value.trim()) {
    showToast("Invalid input", "Enter an email and password.");
    return;
  }

  isSaving.value = true;
  try {
    const created = await createSuperAdmin({
      auth_email: createEmail.value.trim().toLowerCase(),
      password: createPassword.value,
    });
    admins.value = [created, ...admins.value];
    createEmail.value = "";
    createPassword.value = "";
    showToast("Super admin created", `${created.auth_email} was created.`);
  } catch (err) {
    showToast("Create failed", toUserFacingErrorMessage(err, "Unable to create super admin."));
  } finally {
    isSaving.value = false;
  }
};

const openEditModal = (admin: SuperAdminAccount) => {
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
    `${nextStatus ? "Enable" : "Disable"} super admin ${current.auth_email}?`
  );
  if (!confirmed) return;

  isSaving.value = true;
  try {
    const updated = await setSuperAdminStatus({
      id: current.id,
      is_active: nextStatus,
    });
    admins.value = admins.value.map((item) => (item.id === updated.id ? updated : item));
    editTarget.value = updated;
    editEmail.value = updated.auth_email;
    showToast(
      nextStatus ? "Super admin enabled" : "Super admin disabled",
      `${updated.auth_email} is now ${nextStatus ? "active" : "disabled"}.`
    );
  } catch (err) {
    showToast("Status update failed", toUserFacingErrorMessage(err, "Unable to update super admin status."));
  } finally {
    isSaving.value = false;
  }
};

const sendEditReset = async () => {
  if (!editTarget.value) return;
  isSaving.value = true;
  try {
    await sendSuperAdminReset({ auth_email: editTarget.value.auth_email });
    showToast("Reset sent", `Password reset flow triggered for ${editTarget.value.auth_email}.`);
  } catch (err) {
    showToast("Reset failed", toUserFacingErrorMessage(err, "Unable to send reset."));
  } finally {
    isSaving.value = false;
  }
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
    const updated = await updateSuperAdminEmail({
      id: editTarget.value.id,
      auth_email: nextEmail,
    });
    admins.value = admins.value.map((item) => (item.id === updated.id ? updated : item));
    editTarget.value = updated;
    editEmail.value = updated.auth_email;
    showToast("Super admin updated", "Super admin email was updated.");
  } catch (err) {
    showToast("Update failed", toUserFacingErrorMessage(err, "Unable to update super admin."));
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
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

  .section-grid {
    grid-template-columns: 1fr;
  }
}
</style>
