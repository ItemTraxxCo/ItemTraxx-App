<template>
  <main class="page">
    <div class="sa-toolbar">
      <div>
        <RouterLink to="/super-admin" class="sa-back-link">&larr; Back to Control Center</RouterLink>
        <h1 class="sa-toolbar-title">All Borrowers</h1>
        <p class="sa-toolbar-sub">Cross-workspace borrower management.</p>
      </div>
      <div class="sa-toolbar-actions">
        <RouterLink to="/super-admin/workspaces" class="sa-btn">Workspaces</RouterLink>
        <RouterLink to="/super-admin/items" class="sa-btn">All Items</RouterLink>
        <RouterLink to="/super-admin/logs" class="sa-btn">All Logs</RouterLink>
        <RouterLink to="/super-admin/broadcasts" class="sa-btn">Broadcasts</RouterLink>
        <RouterLink to="/super-admin/sales-leads" class="sa-btn">Sales Leads</RouterLink>
        <RouterLink to="/super-admin/customers" class="sa-btn">Customers</RouterLink>
      </div>
    </div>

    <section class="sa-panel">
      <h2>Create Borrower</h2>
      <form class="form" @submit.prevent="handleCreate">
        <label>Workspace<select v-model="formWorkspaceId"><option value="">Select workspace</option><option v-for="t in workspaces" :key="t.id" :value="t.id">{{ t.name }}</option></select></label>
        <label>
          Username
          <input v-model="previewUsername" type="text" readonly title="If you need to change this, contact support." />
        </label>
        <label>
          Borrower ID
          <input v-model="previewBorrowerId" type="text" readonly title="If you need to change this, contact support." />
        </label>
        <div class="panel-actions">
          <button type="button" class="sa-btn" @click="regenerateIdentity">Regenerate</button>
          <button type="submit" class="sa-btn primary" :disabled="isSaving">Create</button>
        </div>
      </form>
    </section>

    <section class="sa-panel">
      <h2>Borrower List</h2>
      <div class="sa-filters">
        <label>Workspace <select v-model="workspaceFilter" @change="loadBorrowers"><option value="all">all workspaces</option><option v-for="t in workspaces" :key="t.id" :value="t.id">{{ t.name }}</option></select></label>
        <label>Search <input v-model="search" type="text" placeholder="Username or ID" /></label>
        <button type="button" class="sa-btn" @click="loadBorrowers">Search</button>
      </div>
      <div class="panel-actions">
        <button type="button" class="sa-btn" @click="exportCsv">Export CSV</button>
        <button type="button" class="sa-btn" @click="exportPdf">Export PDF</button>
      </div>
      <SkeletonLoader v-if="isLoading" variant="table" :rows="6" :columns="4" label="Loading all borrowers" />
      <p v-else-if="error" class="sa-error">{{ error }}</p>
      <div v-else class="sa-table-wrap">
        <table class="sa-table">
          <thead><tr><th>Username</th><th>Workspace</th><th>Borrower ID</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="item in borrowers" :key="item.id">
              <td>{{ item.username }}</td>
              <td>{{ workspaceNameById.get(item.workspace_id) || item.workspace_id }}</td>
              <td>{{ item.borrower_id }}</td>
              <td>
                <div class="sa-table-row-actions">
                  <button type="button" class="sa-btn" @click="startEdit(item)">Edit</button>
                  <button type="button" class="sa-btn danger" @click="requestDelete(item)">Delete</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="editItem" class="sa-panel">
      <h2>Edit Borrower</h2>
      <p class="muted">Borrower identifiers are locked. If you need to change them, contact support.</p>
      <form class="form">
        <label>
          Username
          <input v-model="editUsername" type="text" readonly title="If you need to change this, contact support." />
        </label>
        <label>
          Borrower ID
          <input v-model="editBorrowerId" type="text" readonly title="If you need to change this, contact support." />
        </label>
        <div class="panel-actions"><button type="button" class="sa-btn" @click="cancelEdit">Close</button></div>
      </form>
    </section>

    <div v-if="toastMessage" class="toast"><div class="toast-title">{{ toastTitle }}</div><div class="toast-body">{{ toastMessage }}</div></div>

    <StepUpModal :visible="stepUpVisible" title="Delete Borrower" :message="stepUpMessage" confirm-label="Delete" @cancel="closeStepUp" @confirm="confirmDelete" />
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import SkeletonLoader from "../../components/SkeletonLoader.vue";
import StepUpModal from "../../components/StepUpModal.vue";
import {
  handleSuperAdminUnauthorized,
  isUnauthorizedError,
} from "../../services/authErrorHandling";
import { createSuperBorrower, deleteSuperBorrower, listSuperBorrowers, type SuperBorrowerItem } from "../../services/superBorrowerService";
import { listWorkspaces as listWorkspaces, type SuperWorkspace as SuperWorkspace } from "../../services/superWorkspaceService";
import { exportRowsToCsv, exportRowsToPdf } from "../../services/exportService";
import { generateBorrowerIdentity } from "../../utils/borrowerIdentity";
import { toUserFacingErrorMessage } from "../../services/appErrors";

const router = useRouter();
const workspaces = ref<SuperWorkspace[]>([]);
const borrowers = ref<SuperBorrowerItem[]>([]);
const workspaceFilter = ref("all");
const search = ref("");
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const formWorkspaceId = ref("");
const previewUsername = ref("");
const previewBorrowerId = ref("");
const editItem = ref<SuperBorrowerItem | null>(null);
const editUsername = ref("");
const editBorrowerId = ref("");
const toastTitle = ref("");
const toastMessage = ref("");
const stepUpVisible = ref(false);
const stepUpMessage = ref("");
const deleteTarget = ref<SuperBorrowerItem | null>(null);
let toastTimer: number | null = null;

const workspaceNameById = computed(() => new Map(workspaces.value.map((t) => [t.id, t.name])));

const regenerateIdentity = () => {
  const identity = generateBorrowerIdentity();
  previewUsername.value = identity.username;
  previewBorrowerId.value = identity.borrowerId;
};

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

const loadTenants = async () => {
  try {
    workspaces.value = await listWorkspaces("", "all");
  } catch (err) {
    if (isUnauthorizedError(err)) {
      error.value = "Your session expired. Sign in again.";
      await handleSuperAdminUnauthorized(router);
      return;
    }
    throw err;
  }
};

const loadBorrowers = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    borrowers.value = await listSuperBorrowers(workspaceFilter.value, search.value.trim());
  } catch (err) {
    if (isUnauthorizedError(err)) {
      error.value = "Your session expired. Sign in again.";
      await handleSuperAdminUnauthorized(router);
      return;
    }
    error.value = toUserFacingErrorMessage(err, "Unable to load borrowers.");
  } finally {
    isLoading.value = false;
  }
};

const exportCsv = () => {
  exportRowsToCsv(
    `super-borrowers-${new Date().toISOString().slice(0, 10)}.csv`,
    ["workspace", "username", "borrower_id"],
    borrowers.value.map((item) => ({
      workspace: workspaceNameById.value.get(item.workspace_id) || item.workspace_id,
      username: item.username,
      borrower_id: item.borrower_id,
    }))
  );
};

const exportPdf = async () => {
  await exportRowsToPdf(
    `super-borrowers-${new Date().toISOString().slice(0, 10)}.pdf`,
    "Super Borrowers Export",
    ["workspace", "username", "borrower_id"],
    borrowers.value.map((item) => ({
      workspace: workspaceNameById.value.get(item.workspace_id) || item.workspace_id,
      username: item.username,
      borrower_id: item.borrower_id,
    }))
  );
};

const handleCreate = async () => {
  if (!formWorkspaceId.value) {
    showToast("Invalid input", "Tenant is required.");
    return;
  }
  isSaving.value = true;
  try {
    const created = await createSuperBorrower({
      workspace_id: formWorkspaceId.value,
      username: previewUsername.value,
      borrower_id: previewBorrowerId.value,
    });
    borrowers.value = [created, ...borrowers.value];
    previewUsername.value = created.username;
    previewBorrowerId.value = created.borrower_id;
    regenerateIdentity();
    showToast("Created", "Borrower created.");
  } catch (err) {
    showToast("Create failed", toUserFacingErrorMessage(err, "Unable to create borrower."));
  } finally {
    isSaving.value = false;
  }
};

const startEdit = (item: SuperBorrowerItem) => {
  editItem.value = item;
  editUsername.value = item.username;
  editBorrowerId.value = item.borrower_id;
};

const cancelEdit = () => {
  editItem.value = null;
  editUsername.value = "";
  editBorrowerId.value = "";
};

const requestDelete = (item: SuperBorrowerItem) => {
  deleteTarget.value = item;
  stepUpMessage.value = `Type CONFIRM and enter super password to delete ${item.username}.`;
  stepUpVisible.value = true;
};

const closeStepUp = () => {
  stepUpVisible.value = false;
  deleteTarget.value = null;
};

const confirmDelete = async (payload: { superPassword: string; confirmPhrase: string }) => {
  if (!deleteTarget.value) return;
  isSaving.value = true;
  try {
    await deleteSuperBorrower({
      id: deleteTarget.value.id,
      super_password: payload.superPassword,
      confirm_phrase: payload.confirmPhrase,
    });
    borrowers.value = borrowers.value.filter((item) => item.id !== deleteTarget.value!.id);
    showToast("Deleted", "Borrower deleted.");
    closeStepUp();
  } catch (err) {
    showToast("Delete failed", toUserFacingErrorMessage(err, "Unable to delete borrower."));
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  regenerateIdentity();
  void (async () => {
    await loadTenants();
    await loadBorrowers();
  })();
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

.form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.form label {
  display: grid;
  gap: 0.35rem;
}

@media (max-width: 800px) {
  .form {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 520px) {
  .form {
    grid-template-columns: 1fr;
  }
}
</style>
