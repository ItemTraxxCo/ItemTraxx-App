<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin">Return to Super Admin</RouterLink>
      <RouterLink class="button-link" to="/super-admin/workspaces">Workspaces</RouterLink>
      <RouterLink class="button-link" to="/super-admin/borrowers">All Borrowers</RouterLink>
      <RouterLink class="button-link" to="/super-admin/logs">All Logs</RouterLink>
      <RouterLink class="button-link" to="/super-admin/broadcasts">Broadcasts</RouterLink>
      <RouterLink class="button-link" to="/super-admin/sales-leads">Sales Leads</RouterLink>
      <RouterLink class="button-link" to="/super-admin/customers">Customers</RouterLink>
    </div>

    <h1>All Items</h1>
    <p>Cross-workspace item management.</p>

    <div class="card">
      <h2>Create Item</h2>
      <form class="form" @submit.prevent="handleCreate">
        <label>Workspace<select v-model="formWorkspaceId"><option value="">Select workspace</option><option v-for="t in workspaces" :key="t.id" :value="t.id">{{ t.name }}</option></select></label>
        <label>Name<input v-model="formName" type="text" /></label>
        <label>Barcode<input v-model="formBarcode" type="text" /></label>
        <label>Serial Number<input v-model="formSerial" type="text" /></label>
        <label>Status<select v-model="formStatus"><option value="available">available</option><option value="checked_out">checked_out</option><option value="damaged">damaged</option><option value="lost">lost</option><option value="in_repair">in_repair</option><option value="retired">retired</option><option value="in_studio_only">in_studio_only</option></select></label>
        <label>Notes<textarea v-model="formNotes" rows="3" /></label>
        <div class="form-actions"><button type="submit" class="button-primary" :disabled="isSaving">Create</button></div>
      </form>
    </div>

    <div class="card">
      <h2>Item List</h2>
      <div class="input-row">
        <select v-model="workspaceFilter" @change="loadItem"><option value="all">all workspaces</option><option v-for="t in workspaces" :key="t.id" :value="t.id">{{ t.name }}</option></select>
        <select v-model="statusFilter">
          <option value="all">all statuses</option>
          <option value="available">available</option>
          <option value="checked_out">checked_out</option>
          <option value="damaged">damaged</option>
          <option value="lost">lost</option>
          <option value="in_repair">in_repair</option>
          <option value="retired">retired</option>
          <option value="in_studio_only">in_studio_only</option>
        </select>
        <input v-model="search" type="text" placeholder="Search" />
        <button type="button" @click="loadItem">Search</button>
      </div>
      <p class="muted">Showing {{ filteredItem.length }} of {{ items.length }} items.</p>
      <div class="form-actions">
        <button type="button" @click="exportCsv">Export CSV</button>
        <button type="button" @click="exportPdf">Export PDF</button>
      </div>
      <SkeletonLoader v-if="isLoading" variant="table" :rows="6" :columns="5" label="Loading all items" />
      <p v-else-if="error" class="error">{{ error }}</p>
      <table v-else class="table">
        <thead><tr><th>Name</th><th>Workspace</th><th>Barcode</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-for="item in filteredItem" :key="item.id">
            <td>{{ item.name }}</td>
            <td>{{ workspaceNameById.get(item.workspace_id) || item.workspace_id }}</td>
            <td>{{ item.barcode }}</td>
            <td>{{ item.status }}</td>
            <td>
              <button type="button" @click="startEdit(item)">Edit</button>
              <button type="button" @click="requestDelete(item)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="editItem" class="card">
      <h2>Edit Item</h2>
      <form class="form" @submit.prevent="saveEdit">
        <label>Name<input v-model="editName" type="text" /></label>
        <label>Barcode<input v-model="editBarcode" type="text" /></label>
        <label>Status<select v-model="editStatus"><option value="available">available</option><option value="checked_out">checked_out</option><option value="damaged">damaged</option><option value="lost">lost</option><option value="in_repair">in_repair</option><option value="retired">retired</option><option value="in_studio_only">in_studio_only</option></select></label>
        <label>Notes<textarea v-model="editNotes" rows="3" /></label>
        <div class="form-actions"><button type="submit" class="button-primary" :disabled="isSaving">Save</button><button type="button" @click="cancelEdit">Cancel</button></div>
      </form>
    </div>

    <div v-if="toastMessage" class="toast"><div class="toast-title">{{ toastTitle }}</div><div class="toast-body">{{ toastMessage }}</div></div>

    <StepUpModal :visible="stepUpVisible" :title="stepUpTitle" :message="stepUpMessage" :confirm-label="stepUpConfirm" @cancel="closeStepUp" @confirm="confirmStepUp" />
  </div>
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
import { createSuperItem, deleteSuperItem, listSuperItem, updateSuperItem, type SuperItemRecord } from "../../services/superItemService";
import { listWorkspaces as listWorkspaces, type SuperWorkspace as SuperWorkspace } from "../../services/superWorkspaceService";
import { exportRowsToCsv, exportRowsToPdf } from "../../services/exportService";
import { toUserFacingErrorMessage } from "../../services/appErrors";

const router = useRouter();
const workspaces = ref<SuperWorkspace[]>([]);
const items = ref<SuperItemRecord[]>([]);
const workspaceFilter = ref("all");
const statusFilter = ref("all");
const search = ref("");
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const formWorkspaceId = ref("");
const formName = ref("");
const formBarcode = ref("");
const formSerial = ref("");
const formStatus = ref("available");
const formNotes = ref("");
const editItem = ref<SuperItemRecord | null>(null);
const editName = ref("");
const editBarcode = ref("");
const editStatus = ref("available");
const editNotes = ref("");
const toastTitle = ref("");
const toastMessage = ref("");
const stepUpVisible = ref(false);
const stepUpTitle = ref("");
const stepUpMessage = ref("");
const stepUpConfirm = ref("Confirm");
const stepUpAction = ref<null | { type: "delete"; item: SuperItemRecord } | { type: "status"; item: SuperItemRecord }>(null);
let toastTimer: number | null = null;

const workspaceNameById = computed(() => new Map(workspaces.value.map((t) => [t.id, t.name])));
const filteredItem = computed(() => {
  if (statusFilter.value === "all") return items.value;
  return items.value.filter((item) => item.status === statusFilter.value);
});

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

const loadItem = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    items.value = await listSuperItem(workspaceFilter.value, search.value.trim());
  } catch (err) {
    if (isUnauthorizedError(err)) {
      error.value = "Your session expired. Sign in again.";
      await handleSuperAdminUnauthorized(router);
      return;
    }
    error.value = toUserFacingErrorMessage(err, "Unable to load items.");
  } finally {
    isLoading.value = false;
  }
};

const exportCsv = () => {
  exportRowsToCsv(
    `super-item-${new Date().toISOString().slice(0, 10)}.csv`,
    ["workspace", "name", "barcode", "serial_number", "status", "notes"],
    filteredItem.value.map((item) => ({
      workspace: workspaceNameById.value.get(item.workspace_id) || item.workspace_id,
      name: item.name,
      barcode: item.barcode,
      serial_number: item.serial_number,
      status: item.status,
      notes: item.notes,
    }))
  );
};

const exportPdf = async () => {
  await exportRowsToPdf(
    `super-item-${new Date().toISOString().slice(0, 10)}.pdf`,
    "Super Item Export",
    ["workspace", "name", "barcode", "serial_number", "status", "notes"],
    filteredItem.value.map((item) => ({
      workspace: workspaceNameById.value.get(item.workspace_id) || item.workspace_id,
      name: item.name,
      barcode: item.barcode,
      serial_number: item.serial_number,
      status: item.status,
      notes: item.notes,
    }))
  );
};

const handleCreate = async () => {
  if (!formWorkspaceId.value || !formName.value.trim() || !formBarcode.value.trim()) {
    showToast("Invalid input", "Tenant, name, and barcode are required.");
    return;
  }
  isSaving.value = true;
  try {
    const created = await createSuperItem({
      workspace_id: formWorkspaceId.value,
      name: formName.value.trim(),
      barcode: formBarcode.value.trim(),
      serial_number: formSerial.value.trim() || undefined,
      status: formStatus.value,
      notes: formNotes.value.trim() || undefined,
    });
    items.value = [created, ...items.value];
    formName.value = "";
    formBarcode.value = "";
    formSerial.value = "";
    formNotes.value = "";
    showToast("Created", "Item created.");
  } catch (err) {
    showToast("Create failed", toUserFacingErrorMessage(err, "Unable to create item."));
  } finally {
    isSaving.value = false;
  }
};

const startEdit = (item: SuperItemRecord) => {
  editItem.value = item;
  editName.value = item.name;
  editBarcode.value = item.barcode;
  editStatus.value = item.status;
  editNotes.value = item.notes || "";
};

const cancelEdit = () => {
  editItem.value = null;
  editName.value = "";
  editBarcode.value = "";
  editStatus.value = "available";
  editNotes.value = "";
};

const saveEdit = async () => {
  if (!editItem.value) return;
  const requiresStep = ["lost", "retired"].includes(editStatus.value);
  if (requiresStep) {
    stepUpTitle.value = "Confirm Sensitive Status Change";
    stepUpMessage.value = "Type CONFIRM and enter super password to set this status.";
    stepUpConfirm.value = "Apply";
    stepUpAction.value = { type: "status", item: editItem.value };
    stepUpVisible.value = true;
    return;
  }

  isSaving.value = true;
  try {
    const updated = await updateSuperItem({
      id: editItem.value.id,
      name: editName.value.trim(),
      barcode: editBarcode.value.trim(),
      status: editStatus.value,
      notes: editNotes.value.trim(),
    });
    items.value = items.value.map((item) => (item.id === updated.id ? updated : item));
    cancelEdit();
    showToast("Saved", "Item updated.");
  } catch (err) {
    showToast("Update failed", toUserFacingErrorMessage(err, "Unable to update item."));
  } finally {
    isSaving.value = false;
  }
};

const requestDelete = (item: SuperItemRecord) => {
  stepUpTitle.value = "Delete Item";
  stepUpMessage.value = `Type CONFIRM and enter super password to delete ${item.name}.`;
  stepUpConfirm.value = "Delete";
  stepUpAction.value = { type: "delete", item };
  stepUpVisible.value = true;
};

const closeStepUp = () => {
  stepUpVisible.value = false;
  stepUpAction.value = null;
};

const confirmStepUp = async (payload: { superPassword: string; confirmPhrase: string }) => {
  if (!stepUpAction.value) return;
  isSaving.value = true;
  try {
    if (stepUpAction.value.type === "delete") {
      await deleteSuperItem({
        id: stepUpAction.value.item.id,
        super_password: payload.superPassword,
        confirm_phrase: payload.confirmPhrase,
      });
      items.value = items.value.filter((item) => item.id !== stepUpAction.value!.item.id);
      showToast("Deleted", "Item deleted.");
    } else {
      const updated = await updateSuperItem({
        id: stepUpAction.value.item.id,
        name: editName.value.trim(),
        barcode: editBarcode.value.trim(),
        status: editStatus.value,
        notes: editNotes.value.trim(),
        super_password: payload.superPassword,
        confirm_phrase: payload.confirmPhrase,
      });
      items.value = items.value.map((item) => (item.id === updated.id ? updated : item));
      cancelEdit();
      showToast("Saved", "Item updated.");
    }
    closeStepUp();
  } catch (err) {
    showToast("Action failed", toUserFacingErrorMessage(err, "Action failed."));
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  void (async () => {
    await loadTenants();
    await loadItem();
  })();
});
</script>
