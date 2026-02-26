<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin">Return to Super Admin</RouterLink>
      <RouterLink class="button-link" to="/super-admin/tenants">Tenants</RouterLink>
      <RouterLink class="button-link" to="/super-admin/gear">All Items</RouterLink>
      <RouterLink class="button-link" to="/super-admin/logs">All Logs</RouterLink>
      <RouterLink class="button-link" to="/super-admin/broadcasts">Broadcasts</RouterLink>
      <RouterLink class="button-link" to="/super-admin/sales-leads">Sales Leads</RouterLink>
      <RouterLink class="button-link" to="/super-admin/customers">Customers</RouterLink>
    </div>

    <h1>All Students</h1>
    <p>Cross-tenant student management.</p>

    <div class="card">
      <h2>Create Student</h2>
      <form class="form" @submit.prevent="handleCreate">
        <label>Tenant<select v-model="formTenantId"><option value="">Select tenant</option><option v-for="t in tenants" :key="t.id" :value="t.id">{{ t.name }}</option></select></label>
        <label>
          Username
          <input v-model="previewUsername" type="text" readonly title="If you need to change this, contact support." />
        </label>
        <label>
          Student ID
          <input v-model="previewStudentId" type="text" readonly title="If you need to change this, contact support." />
        </label>
        <div class="form-actions">
          <button type="button" @click="regenerateIdentity">Regenerate</button>
          <button type="submit" class="button-primary" :disabled="isSaving">Create</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>Student List</h2>
      <div class="input-row">
        <select v-model="tenantFilter" @change="loadStudents"><option value="all">all tenants</option><option v-for="t in tenants" :key="t.id" :value="t.id">{{ t.name }}</option></select>
        <input v-model="search" type="text" placeholder="Search" />
        <button type="button" @click="loadStudents">Search</button>
      </div>
      <div class="form-actions">
        <button type="button" @click="exportCsv">Export CSV</button>
        <button type="button" @click="exportPdf">Export PDF</button>
      </div>
      <p v-if="isLoading" class="muted">Loading students...</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <table v-else class="table">
        <thead><tr><th>Username</th><th>Tenant</th><th>Student ID</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-for="item in students" :key="item.id">
            <td>{{ item.username }}</td>
            <td>{{ tenantNameById.get(item.tenant_id) || item.tenant_id }}</td>
            <td>{{ item.student_id }}</td>
            <td>
              <button type="button" @click="startEdit(item)">Edit</button>
              <span class="button-spacer"></span>
              <button type="button" @click="requestDelete(item)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="editItem" class="card">
      <h2>Edit Student</h2>
      <p class="muted">Student identifiers are locked. If you need to change them, contact support.</p>
      <form class="form">
        <label>
          Username
          <input v-model="editUsername" type="text" readonly title="If you need to change this, contact support." />
        </label>
        <label>
          Student ID
          <input v-model="editStudentId" type="text" readonly title="If you need to change this, contact support." />
        </label>
        <div class="form-actions"><button type="button" @click="cancelEdit">Close</button></div>
      </form>
    </div>

    <div v-if="toastMessage" class="toast"><div class="toast-title">{{ toastTitle }}</div><div class="toast-body">{{ toastMessage }}</div></div>

    <StepUpModal :visible="stepUpVisible" title="Delete Student" :message="stepUpMessage" confirm-label="Delete" @cancel="closeStepUp" @confirm="confirmDelete" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import StepUpModal from "../../components/StepUpModal.vue";
import { createSuperStudent, deleteSuperStudent, listSuperStudents, type SuperStudentItem } from "../../services/superStudentService";
import { listTenants, type SuperTenant } from "../../services/superTenantService";
import { exportRowsToCsv, exportRowsToPdf } from "../../services/exportService";
import { generateStudentIdentity } from "../../utils/studentIdentity";

const tenants = ref<SuperTenant[]>([]);
const students = ref<SuperStudentItem[]>([]);
const tenantFilter = ref("all");
const search = ref("");
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const formTenantId = ref("");
const previewUsername = ref("");
const previewStudentId = ref("");
const editItem = ref<SuperStudentItem | null>(null);
const editUsername = ref("");
const editStudentId = ref("");
const toastTitle = ref("");
const toastMessage = ref("");
const stepUpVisible = ref(false);
const stepUpMessage = ref("");
const deleteTarget = ref<SuperStudentItem | null>(null);
let toastTimer: number | null = null;

const tenantNameById = computed(() => new Map(tenants.value.map((t) => [t.id, t.name])));

const regenerateIdentity = () => {
  const identity = generateStudentIdentity();
  previewUsername.value = identity.username;
  previewStudentId.value = identity.studentId;
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
  tenants.value = await listTenants("", "all");
};

const loadStudents = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    students.value = await listSuperStudents(tenantFilter.value, search.value.trim());
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load students.";
  } finally {
    isLoading.value = false;
  }
};

const exportCsv = () => {
  exportRowsToCsv(
    `super-students-${new Date().toISOString().slice(0, 10)}.csv`,
    ["tenant", "username", "student_id"],
    students.value.map((item) => ({
      tenant: tenantNameById.value.get(item.tenant_id) || item.tenant_id,
      username: item.username,
      student_id: item.student_id,
    }))
  );
};

const exportPdf = async () => {
  await exportRowsToPdf(
    `super-students-${new Date().toISOString().slice(0, 10)}.pdf`,
    "Super Students Export",
    ["tenant", "username", "student_id"],
    students.value.map((item) => ({
      tenant: tenantNameById.value.get(item.tenant_id) || item.tenant_id,
      username: item.username,
      student_id: item.student_id,
    }))
  );
};

const handleCreate = async () => {
  if (!formTenantId.value) {
    showToast("Invalid input", "Tenant is required.");
    return;
  }
  isSaving.value = true;
  try {
    const created = await createSuperStudent({
      tenant_id: formTenantId.value,
      username: previewUsername.value,
      student_id: previewStudentId.value,
    });
    students.value = [created, ...students.value];
    previewUsername.value = created.username;
    previewStudentId.value = created.student_id;
    regenerateIdentity();
    showToast("Created", "Student created.");
  } catch (err) {
    showToast("Create failed", err instanceof Error ? err.message : "Unable to create student.");
  } finally {
    isSaving.value = false;
  }
};

const startEdit = (item: SuperStudentItem) => {
  editItem.value = item;
  editUsername.value = item.username;
  editStudentId.value = item.student_id;
};

const cancelEdit = () => {
  editItem.value = null;
  editUsername.value = "";
  editStudentId.value = "";
};

const requestDelete = (item: SuperStudentItem) => {
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
    await deleteSuperStudent({
      id: deleteTarget.value.id,
      super_password: payload.superPassword,
      confirm_phrase: payload.confirmPhrase,
    });
    students.value = students.value.filter((item) => item.id !== deleteTarget.value!.id);
    showToast("Deleted", "Student deleted.");
    closeStepUp();
  } catch (err) {
    showToast("Delete failed", err instanceof Error ? err.message : "Unable to delete student.");
  } finally {
    isSaving.value = false;
  }
};

onMounted(async () => {
  regenerateIdentity();
  await loadTenants();
  await loadStudents();
});
</script>

<style scoped>
.button-spacer {
  display: inline-block;
  width: 0.5rem;
}
</style>
