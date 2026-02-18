<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin">Return to Super Admin</RouterLink>
      <RouterLink class="button-link" to="/super-admin/tenants">Tenants</RouterLink>
      <RouterLink class="button-link" to="/super-admin/students">All Students</RouterLink>
      <RouterLink class="button-link" to="/super-admin/logs">All Logs</RouterLink>
      <RouterLink class="button-link" to="/super-admin/broadcasts">Broadcasts</RouterLink>
    </div>

    <h1>All Gear</h1>
    <p>Cross-tenant gear management.</p>

    <div class="card">
      <h2>Create Gear</h2>
      <form class="form" @submit.prevent="handleCreate">
        <label>Tenant<select v-model="formTenantId"><option value="">Select tenant</option><option v-for="t in tenants" :key="t.id" :value="t.id">{{ t.name }}</option></select></label>
        <label>Name<input v-model="formName" type="text" /></label>
        <label>Barcode<input v-model="formBarcode" type="text" /></label>
        <label>Serial Number<input v-model="formSerial" type="text" /></label>
        <label>Status<select v-model="formStatus"><option value="available">available</option><option value="checked_out">checked_out</option><option value="damaged">damaged</option><option value="lost">lost</option><option value="in_repair">in_repair</option><option value="retired">retired</option><option value="in_studio_only">in_studio_only</option></select></label>
        <label>Notes<textarea v-model="formNotes" rows="3" /></label>
        <div class="form-actions"><button type="submit" class="button-primary" :disabled="isSaving">Create</button></div>
      </form>
    </div>

    <div class="card">
      <h2>Gear List</h2>
      <div class="input-row">
        <select v-model="tenantFilter" @change="loadGear"><option value="all">all tenants</option><option v-for="t in tenants" :key="t.id" :value="t.id">{{ t.name }}</option></select>
        <input v-model="search" type="text" placeholder="Search" />
        <button type="button" @click="loadGear">Search</button>
      </div>
      <div class="form-actions">
        <button type="button" @click="exportCsv">Export CSV</button>
        <button type="button" @click="exportPdf">Export PDF</button>
      </div>
      <p v-if="isLoading" class="muted">Loading gear...</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <table v-else class="table">
        <thead><tr><th>Name</th><th>Tenant</th><th>Barcode</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-for="item in gear" :key="item.id">
            <td>{{ item.name }}</td>
            <td>{{ tenantNameById.get(item.tenant_id) || item.tenant_id }}</td>
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
      <h2>Edit Gear</h2>
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
import { RouterLink } from "vue-router";
import StepUpModal from "../../components/StepUpModal.vue";
import { createSuperGear, deleteSuperGear, listSuperGear, updateSuperGear, type SuperGearItem } from "../../services/superGearService";
import { listTenants, type SuperTenant } from "../../services/superTenantService";
import { exportRowsToCsv, exportRowsToPdf } from "../../services/exportService";

const tenants = ref<SuperTenant[]>([]);
const gear = ref<SuperGearItem[]>([]);
const tenantFilter = ref("all");
const search = ref("");
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const formTenantId = ref("");
const formName = ref("");
const formBarcode = ref("");
const formSerial = ref("");
const formStatus = ref("available");
const formNotes = ref("");
const editItem = ref<SuperGearItem | null>(null);
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
const stepUpAction = ref<null | { type: "delete"; item: SuperGearItem } | { type: "status"; item: SuperGearItem }>(null);
let toastTimer: number | null = null;

const tenantNameById = computed(() => new Map(tenants.value.map((t) => [t.id, t.name])));

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
  tenants.value = await listTenants("", "all");
};

const loadGear = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    gear.value = await listSuperGear(tenantFilter.value, search.value.trim());
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load gear.";
  } finally {
    isLoading.value = false;
  }
};

const exportCsv = () => {
  exportRowsToCsv(
    `super-gear-${new Date().toISOString().slice(0, 10)}.csv`,
    ["tenant", "name", "barcode", "serial_number", "status", "notes"],
    gear.value.map((item) => ({
      tenant: tenantNameById.value.get(item.tenant_id) || item.tenant_id,
      name: item.name,
      barcode: item.barcode,
      serial_number: item.serial_number,
      status: item.status,
      notes: item.notes,
    }))
  );
};

const exportPdf = () => {
  exportRowsToPdf(
    `super-gear-${new Date().toISOString().slice(0, 10)}.pdf`,
    "Super Gear Export",
    ["tenant", "name", "barcode", "serial_number", "status", "notes"],
    gear.value.map((item) => ({
      tenant: tenantNameById.value.get(item.tenant_id) || item.tenant_id,
      name: item.name,
      barcode: item.barcode,
      serial_number: item.serial_number,
      status: item.status,
      notes: item.notes,
    }))
  );
};

const handleCreate = async () => {
  if (!formTenantId.value || !formName.value.trim() || !formBarcode.value.trim()) {
    showToast("Invalid input", "Tenant, name, and barcode are required.");
    return;
  }
  isSaving.value = true;
  try {
    const created = await createSuperGear({
      tenant_id: formTenantId.value,
      name: formName.value.trim(),
      barcode: formBarcode.value.trim(),
      serial_number: formSerial.value.trim() || undefined,
      status: formStatus.value,
      notes: formNotes.value.trim() || undefined,
    });
    gear.value = [created, ...gear.value];
    formName.value = "";
    formBarcode.value = "";
    formSerial.value = "";
    formNotes.value = "";
    showToast("Created", "Gear item created.");
  } catch (err) {
    showToast("Create failed", err instanceof Error ? err.message : "Unable to create gear.");
  } finally {
    isSaving.value = false;
  }
};

const startEdit = (item: SuperGearItem) => {
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
    const updated = await updateSuperGear({
      id: editItem.value.id,
      name: editName.value.trim(),
      barcode: editBarcode.value.trim(),
      status: editStatus.value,
      notes: editNotes.value.trim(),
    });
    gear.value = gear.value.map((item) => (item.id === updated.id ? updated : item));
    cancelEdit();
    showToast("Saved", "Gear updated.");
  } catch (err) {
    showToast("Update failed", err instanceof Error ? err.message : "Unable to update gear.");
  } finally {
    isSaving.value = false;
  }
};

const requestDelete = (item: SuperGearItem) => {
  stepUpTitle.value = "Delete Gear";
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
      await deleteSuperGear({
        id: stepUpAction.value.item.id,
        super_password: payload.superPassword,
        confirm_phrase: payload.confirmPhrase,
      });
      gear.value = gear.value.filter((item) => item.id !== stepUpAction.value!.item.id);
      showToast("Deleted", "Gear deleted.");
    } else {
      const updated = await updateSuperGear({
        id: stepUpAction.value.item.id,
        name: editName.value.trim(),
        barcode: editBarcode.value.trim(),
        status: editStatus.value,
        notes: editNotes.value.trim(),
        super_password: payload.superPassword,
        confirm_phrase: payload.confirmPhrase,
      });
      gear.value = gear.value.map((item) => (item.id === updated.id ? updated : item));
      cancelEdit();
      showToast("Saved", "Gear updated.");
    }
    closeStepUp();
  } catch (err) {
    showToast("Action failed", err instanceof Error ? err.message : "Action failed.");
  } finally {
    isSaving.value = false;
  }
};

onMounted(async () => {
  await loadTenants();
  await loadGear();
});
</script>
