<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/tenant/admin">Return to admin panel</RouterLink>
    </div>
    <h1>Student Management</h1>
    <p>Add students and view details.</p>
    <p class="muted">Export students to CSV or PDF from the table section.</p>

    <div class="card">
      <h2>Add Student</h2>
      <form class="form" @submit.prevent="handleCreate">
        <label>
          Username
          <input
            v-model="usernamePreview"
            type="text"
            readonly
            title="If you need to change this, contact support."
          />
        </label>
        <label>
          Student ID
          <input
            v-model="studentIdPreview"
            type="text"
            readonly
            title="If you need to change this, contact support."
          />
        </label>
        <div class="form-actions">
          <button type="button" @click="regenerateIdentity">Regenerate</button>
          <button type="submit" class="button-primary" :disabled="isSaving">Add student</button>
        </div>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="success">{{ success }}</p>
    </div>

    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
      <div v-if="toastActionLabel" class="toast-actions">
        <button type="button" class="toast-action-button" @click="runToastAction">
          {{ toastActionLabel }}
        </button>
      </div>
    </div>

    <div class="card">
      <h2>Students</h2>
      <div class="form-grid-2">
        <label>
          Search students
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search by username or student ID"
          />
        </label>
      </div>
      <div class="form-actions">
        <button type="button" @click="exportCsv">Export CSV</button>
        <button type="button" @click="exportPdf">Export PDF</button>
      </div>
      <p class="muted">Showing {{ filteredStudents.length }} of {{ students.length }} students.</p>
      <p v-if="isLoading" class="muted">Loading students...</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Student ID</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in filteredStudents" :key="item.id">
            <td>{{ item.username }}</td>
            <td>{{ item.student_id }}</td>
            <td>
              <div class="admin-actions">
                <button type="button" @click="openDetails(item)">Details</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Archived Students</h2>
      <p class="muted">Archived students can be restored at any time.</p>
      <p v-if="isLoadingArchived" class="muted">Loading archived students...</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Student ID</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in filteredArchivedStudents" :key="item.id">
            <td>{{ item.username }}</td>
            <td>{{ item.student_id }}</td>
            <td>
              <button type="button" class="link" :disabled="isSaving" @click="handleRestore(item)">
                Restore
              </button>
            </td>
          </tr>
          <tr v-if="filteredArchivedStudents.length === 0">
            <td colspan="3" class="muted">No archived students.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="featureFlags.enable_bulk_student_tools" class="card">
      <h2>Bulk Student Tools</h2>
      <p class="muted">Generate identities in bulk and import them in one action.</p>
      <div class="form-grid-2">
        <label>
          Generate count
          <input v-model.number="bulkGenerateCount" type="number" min="1" max="200" />
        </label>
      </div>
      <div class="form-actions">
        <button type="button" @click="generateBulkRows">Generate identities</button>
      </div>

      <div class="form-actions">
        <button
          type="button"
          class="button-primary"
          :disabled="isSaving || bulkRows.length === 0"
          @click="runBulkImport"
        >
          Import Generated Rows
        </button>
      </div>

      <p class="muted" v-if="bulkRows.length">
        Generated rows ready: {{ bulkRows.length }}
      </p>
    </div>

    <div v-if="showDetails" class="modal-backdrop">
      <div class="modal">
        <h2>Student details</h2>
        <p class="muted">View username, student ID, and checkout history.</p>
        <h3>{{ selected?.username }}</h3>
        <p class="muted">Student ID: {{ selected?.student_id }}</p>
        <div class="form-grid-2">
          <label>
            Username
            <input
              class="identity-readonly"
              :value="selected?.username || ''"
              type="text"
              readonly
              title="If you need to change this, contact support."
            />
          </label>
          <label>
            Student ID
            <input
              class="identity-readonly"
              :value="selected?.student_id || ''"
              type="text"
              readonly
              title="If you need to change this, contact support."
            />
          </label>
        </div>

        <p v-if="detailsLoading" class="muted">Loading details...</p>
        <div v-else>
          <div>
            <h3>Currently checked out</h3>
            <ul v-if="details?.checkedOutGear.length">
              <li v-for="gear in details.checkedOutGear" :key="gear.id">
                {{ gear.name }}
                <span class="muted">({{ gear.barcode }})</span>
              </li>
            </ul>
            <p v-else class="muted">No items currently checked out.</p>
          </div>

          <div>
            <h3>Last checkout</h3>
            <p v-if="details?.lastCheckout">
              {{ formatTime(details.lastCheckout.action_time) }}
              <span v-if="details.lastCheckout.gear_name"> — {{ details.lastCheckout.gear_name }} </span>
            </p>
            <p v-else class="muted">No checkout history.</p>
          </div>

          <div>
            <h3>Last return</h3>
            <p v-if="details?.lastReturn">
              {{ formatTime(details.lastReturn.action_time) }}
              <span v-if="details.lastReturn.gear_name"> — {{ details.lastReturn.gear_name }} </span>
            </p>
            <p v-else class="muted">No return history.</p>
          </div>
        </div>

        <div class="admin-actions">
          <button type="button" class="link" @click="removeSelected">Archive student</button>
          <button type="button" class="link" @click="closeDetails">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { getAuthState } from "../../../store/authState";
import {
  bulkCreateStudents,
  createStudent,
  deleteStudent,
  fetchDeletedStudents,
  fetchStudentDetails,
  fetchStudents,
  restoreStudent,
  type StudentDetails,
  type StudentItem,
} from "../../../services/studentService";
import { fetchTenantSettings } from "../../../services/adminOpsService";
import { logAdminAction } from "../../../services/auditLogService";
import { enforceAdminRateLimit } from "../../../services/rateLimitService";
import { exportRowsToCsv, exportRowsToPdf } from "../../../services/exportService";
import { generateStudentIdentity } from "../../../utils/studentIdentity";

const students = ref<StudentItem[]>([]);
const archivedStudents = ref<StudentItem[]>([]);
const isLoading = ref(false);
const isLoadingArchived = ref(false);
const isSaving = ref(false);
const error = ref("");
const success = ref("");
const showDetails = ref(false);
const detailsLoading = ref(false);
const details = ref<StudentDetails | null>(null);
const selected = ref<StudentItem | null>(null);
const toastTitle = ref("");
const toastMessage = ref("");
const toastActionLabel = ref("");
const toastAction = ref<(() => Promise<void>) | null>(null);

const usernamePreview = ref("");
const studentIdPreview = ref("");
const searchQuery = ref("");
const featureFlags = ref({
  enable_notifications: true,
  enable_bulk_item_import: true,
  enable_bulk_student_tools: true,
  enable_status_tracking: true,
  enable_barcode_generator: true,
});
const bulkGenerateCount = ref(20);
const bulkRows = ref<Array<{ username: string; student_id: string }>>([]);
let toastTimer: number | null = null;

const matchesSearch = (item: StudentItem, query: string) => {
  if (!query) return true;
  const haystack = `${item.username} ${item.student_id}`.toLowerCase();
  return haystack.includes(query);
};

const filteredStudents = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return students.value.filter((item) => matchesSearch(item, query));
});

const filteredArchivedStudents = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return archivedStudents.value.filter((item) => matchesSearch(item, query));
});

const showToast = (title: string, message: string) => {
  toastTitle.value = title;
  toastMessage.value = message;
  toastActionLabel.value = "";
  toastAction.value = null;
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastTitle.value = "";
    toastMessage.value = "";
    toastTimer = null;
  }, 4000);
};

const showToastWithAction = (
  title: string,
  message: string,
  actionLabel: string,
  action: () => Promise<void>
) => {
  toastTitle.value = title;
  toastMessage.value = message;
  toastActionLabel.value = actionLabel;
  toastAction.value = action;
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastTitle.value = "";
    toastMessage.value = "";
    toastActionLabel.value = "";
    toastAction.value = null;
    toastTimer = null;
  }, 7000);
};

const runToastAction = async () => {
  if (!toastAction.value) return;
  const action = toastAction.value;
  toastAction.value = null;
  toastActionLabel.value = "";
  await action();
};

const showDuplicateStudentToast = () => {
  showToast(
    "Unable to add student.",
    "Check student ID number and make sure it does not match another student's ID number. If you believe this is an error, contact support with the student details you want to add."
  );
};

const loadArchivedStudents = async () => {
  isLoadingArchived.value = true;
  try {
    archivedStudents.value = await fetchDeletedStudents();
  } catch {
    archivedStudents.value = [];
  } finally {
    isLoadingArchived.value = false;
  }
};

const loadStudents = async () => {
  isLoading.value = true;
  error.value = "";
  try {
    students.value = await fetchStudents();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load students. Please sign out completeley and sign back in.";
  } finally {
    isLoading.value = false;
  }
  await loadArchivedStudents();
};

const regenerateIdentity = () => {
  const next = generateStudentIdentity();
  usernamePreview.value = next.username;
  studentIdPreview.value = next.studentId;
};

const generateBulkRows = () => {
  const count = Math.min(200, Math.max(1, Math.round(Number(bulkGenerateCount.value) || 0)));
  bulkGenerateCount.value = count;
  bulkRows.value = Array.from({ length: count }, () => generateStudentIdentity()).map((row) => ({
    username: row.username,
    student_id: row.studentId,
  }));
};

const runBulkImport = async () => {
  if (!bulkRows.value.length) {
    showToast("No rows to import.", "Generate rows first.");
    return;
  }
  error.value = "";
  success.value = "";
  isSaving.value = true;
  try {
    await enforceAdminRateLimit();
    const result = await bulkCreateStudents(bulkRows.value);
    students.value = [...result.inserted, ...students.value];
    success.value = `Imported ${result.inserted_count} student(s).`;
    showToast("Bulk import complete", `Imported ${result.inserted_count}, skipped ${result.skipped_count}.`);
    bulkRows.value = [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to import students.";
    showToast("Import failed", error.value);
  } finally {
    isSaving.value = false;
  }
};

const exportCsv = () => {
  exportRowsToCsv(
    `students-${new Date().toISOString().slice(0, 10)}.csv`,
    ["username", "student_id"],
    filteredStudents.value
  );
};

const exportPdf = async () => {
  await exportRowsToPdf(
    `students-${new Date().toISOString().slice(0, 10)}.pdf`,
    "Student Export",
    ["username", "student_id"],
    filteredStudents.value
  );
};

const handleCreate = async () => {
  error.value = "";
  success.value = "";

  const auth = getAuthState();
  if (!auth.tenantContextId) {
    error.value = "Missing tenant context. Please sign out completeley and sign back in.";
    return;
  }

  isSaving.value = true;
  try {
    await enforceAdminRateLimit();
    const created = await createStudent({
      tenant_id: auth.tenantContextId,
      username: usernamePreview.value,
      student_id: studentIdPreview.value,
    });
    await logAdminAction({
      action_type: "student_create",
      entity_type: "student",
      entity_id: created.id,
      metadata: { student_id: created.student_id },
    });
    students.value = [created, ...students.value];
    usernamePreview.value = created.username;
    studentIdPreview.value = created.student_id;
    regenerateIdentity();
    success.value = "Student added.";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to create student. If you belive this is an error, please contact support.";
    showDuplicateStudentToast();
  } finally {
    isSaving.value = false;
  }
};

onMounted(() => {
  regenerateIdentity();
  void (async () => {
    try {
      const settings = await fetchTenantSettings();
      featureFlags.value = settings.feature_flags;
    } catch {
      featureFlags.value = {
        enable_notifications: true,
        enable_bulk_item_import: true,
        enable_bulk_student_tools: true,
        enable_status_tracking: true,
        enable_barcode_generator: true,
      };
    }
    await loadStudents();
  })();
});

const openDetails = async (item: StudentItem) => {
  if (showDetails.value && selected.value?.id === item.id) {
    closeDetails();
    return;
  }
  selected.value = item;
  showDetails.value = true;
  detailsLoading.value = true;
  error.value = "";
  try {
    details.value = await fetchStudentDetails(item.id);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to load details. Please sign out completeley and sign back in.";
    details.value = null;
  } finally {
    detailsLoading.value = false;
  }
};

const closeDetails = () => {
  showDetails.value = false;
  details.value = null;
  selected.value = null;
};

const formatTime = (value: string) => {
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const removeStudent = async (item: StudentItem) => {
  const confirmed = window.confirm(`Archive student "${item.username}"? You can restore them later.`);
  if (!confirmed) return;
  error.value = "";
  success.value = "";
  isSaving.value = true;
  try {
    await enforceAdminRateLimit();
    await deleteStudent(item.id);
    await logAdminAction({
      action_type: "student_archive",
      entity_type: "student",
      entity_id: item.id,
      metadata: { student_id: item.student_id },
    });
    students.value = students.value.filter((row) => row.id !== item.id);
    archivedStudents.value = [item, ...archivedStudents.value];
    success.value = "Student archived.";
    showToastWithAction(
      "Student archived",
      `${item.username} was archived.`,
      "Undo",
      async () => {
        await handleRestore(item);
      }
    );
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to archive student. Please sign out completeley and sign back in.";
  } finally {
    isSaving.value = false;
  }
};

const removeSelected = async () => {
  if (!selected.value) return;
  await removeStudent(selected.value);
  if (!error.value) {
    closeDetails();
  }
};

const handleRestore = async (item: StudentItem) => {
  error.value = "";
  success.value = "";
  isSaving.value = true;
  try {
    await enforceAdminRateLimit();
    const restored = await restoreStudent(item.id);
    await logAdminAction({
      action_type: "student_restore",
      entity_type: "student",
      entity_id: item.id,
      metadata: { student_id: item.student_id },
    });
    archivedStudents.value = archivedStudents.value.filter((row) => row.id !== item.id);
    students.value = [restored, ...students.value];
    success.value = "Student restored.";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to restore student.";
  } finally {
    isSaving.value = false;
  }
};

onUnmounted(() => {
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
});
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(10, 14, 25, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 1000;
}

.modal {
  width: min(680px, 100%);
  max-height: 90vh;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  padding: 1rem;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.24);
}

.modal h3 {
  margin-top: 0.25rem;
  margin-bottom: 0.5rem;
}

.modal .admin-actions {
  margin-top: 0.75rem;
}

.identity-readonly {
  width: auto;
  min-width: 120px;
  max-width: 100%;
}
</style>
