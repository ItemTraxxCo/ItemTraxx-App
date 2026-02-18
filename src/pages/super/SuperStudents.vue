<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/super-admin">Return to Super Admin</RouterLink>
      <RouterLink class="button-link" to="/super-admin/tenants">Tenants</RouterLink>
      <RouterLink class="button-link" to="/super-admin/gear">All Gear</RouterLink>
      <RouterLink class="button-link" to="/super-admin/logs">All Logs</RouterLink>
      <RouterLink class="button-link" to="/super-admin/broadcasts">Broadcasts</RouterLink>
    </div>

    <h1>All Students</h1>
    <p>Cross-tenant student management.</p>

    <div class="card">
      <h2>Create Student</h2>
      <form class="form" @submit.prevent="handleCreate">
        <label>Tenant<select v-model="formTenantId"><option value="">Select tenant</option><option v-for="t in tenants" :key="t.id" :value="t.id">{{ t.name }}</option></select></label>
        <label>First Name<input v-model="formFirstName" type="text" /></label>
        <label>Last Name<input v-model="formLastName" type="text" /></label>
        <label>Student ID<input v-model="formStudentId" type="text" /></label>
        <div class="form-actions"><button type="submit" class="button-primary" :disabled="isSaving">Create</button></div>
      </form>
    </div>

    <div class="card">
      <h2>Student List</h2>
      <div class="input-row">
        <select v-model="tenantFilter" @change="loadStudents"><option value="all">all tenants</option><option v-for="t in tenants" :key="t.id" :value="t.id">{{ t.name }}</option></select>
        <input v-model="search" type="text" placeholder="Search" />
        <button type="button" @click="loadStudents">Search</button>
      </div>
      <p v-if="isLoading" class="muted">Loading students...</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <table v-else class="table">
        <thead><tr><th>Name</th><th>Tenant</th><th>Student ID</th><th>Actions</th></tr></thead>
        <tbody>
          <tr v-for="item in students" :key="item.id">
            <td>{{ item.first_name }} {{ item.last_name }}</td>
            <td>{{ tenantNameById.get(item.tenant_id) || item.tenant_id }}</td>
            <td>{{ item.student_id }}</td>
            <td>
              <button type="button" @click="startEdit(item)">Edit</button>
              <button type="button" @click="requestDelete(item)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="editItem" class="card">
      <h2>Edit Student</h2>
      <form class="form" @submit.prevent="saveEdit">
        <label>First Name<input v-model="editFirstName" type="text" /></label>
        <label>Last Name<input v-model="editLastName" type="text" /></label>
        <label>Student ID<input v-model="editStudentId" type="text" /></label>
        <div class="form-actions"><button type="submit" class="button-primary" :disabled="isSaving">Save</button><button type="button" @click="cancelEdit">Cancel</button></div>
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
import { createSuperStudent, deleteSuperStudent, listSuperStudents, updateSuperStudent, type SuperStudentItem } from "../../services/superStudentService";
import { listTenants, type SuperTenant } from "../../services/superTenantService";

const tenants = ref<SuperTenant[]>([]);
const students = ref<SuperStudentItem[]>([]);
const tenantFilter = ref("all");
const search = ref("");
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const formTenantId = ref("");
const formFirstName = ref("");
const formLastName = ref("");
const formStudentId = ref("");
const editItem = ref<SuperStudentItem | null>(null);
const editFirstName = ref("");
const editLastName = ref("");
const editStudentId = ref("");
const toastTitle = ref("");
const toastMessage = ref("");
const stepUpVisible = ref(false);
const stepUpMessage = ref("");
const deleteTarget = ref<SuperStudentItem | null>(null);
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

const handleCreate = async () => {
  if (!formTenantId.value || !formFirstName.value.trim() || !formLastName.value.trim() || !formStudentId.value.trim()) {
    showToast("Invalid input", "All fields are required.");
    return;
  }
  isSaving.value = true;
  try {
    const created = await createSuperStudent({
      tenant_id: formTenantId.value,
      first_name: formFirstName.value.trim(),
      last_name: formLastName.value.trim(),
      student_id: formStudentId.value.trim(),
    });
    students.value = [created, ...students.value];
    formFirstName.value = "";
    formLastName.value = "";
    formStudentId.value = "";
    showToast("Created", "Student created.");
  } catch (err) {
    showToast("Create failed", err instanceof Error ? err.message : "Unable to create student.");
  } finally {
    isSaving.value = false;
  }
};

const startEdit = (item: SuperStudentItem) => {
  editItem.value = item;
  editFirstName.value = item.first_name;
  editLastName.value = item.last_name;
  editStudentId.value = item.student_id;
};

const cancelEdit = () => {
  editItem.value = null;
  editFirstName.value = "";
  editLastName.value = "";
  editStudentId.value = "";
};

const saveEdit = async () => {
  if (!editItem.value) return;
  isSaving.value = true;
  try {
    const updated = await updateSuperStudent({
      id: editItem.value.id,
      first_name: editFirstName.value.trim(),
      last_name: editLastName.value.trim(),
      student_id: editStudentId.value.trim(),
    });
    students.value = students.value.map((item) => (item.id === updated.id ? updated : item));
    cancelEdit();
    showToast("Saved", "Student updated.");
  } catch (err) {
    showToast("Update failed", err instanceof Error ? err.message : "Unable to update student.");
  } finally {
    isSaving.value = false;
  }
};

const requestDelete = (item: SuperStudentItem) => {
  deleteTarget.value = item;
  stepUpMessage.value = `Type CONFIRM and enter super password to delete ${item.first_name} ${item.last_name}.`;
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
  await loadTenants();
  await loadStudents();
});
</script>
