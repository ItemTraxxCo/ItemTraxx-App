<template>
  <div class="page">
    <div class="page-nav-left">
      <RouterLink class="button-link" to="/tenant/admin">Return to admin panel</RouterLink>
    </div>
    <h1>Student Management</h1>
    <p>Add students and view details.</p>
    <p class="muted">Ability to export student data to PDF and CSV coming soon.</p>

    <div class="card">
      <h2>Add Student</h2>
      <form class="form" @submit.prevent="handleCreate">
        <label>
          First name
          <input v-model="firstName" type="text" placeholder="First name" />
        </label>
        <label>
          Last name
          <input v-model="lastName" type="text" placeholder="Last name" />
        </label>
        <label>
          Student ID
          <input v-model="studentId" type="text" placeholder="Student ID" />
        </label>
        <div class="form-actions">
          <button type="submit" class="button-primary" :disabled="isSaving">Add student</button>
        </div>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="success">{{ success }}</p>
    </div>
    <div v-if="toastMessage" class="toast">
      <div class="toast-title">{{ toastTitle }}</div>
      <div class="toast-body">{{ toastMessage }}</div>
    </div>

    <div class="card">
      <h2>Students</h2>
      <p v-if="isLoading" class="muted">Loading students...</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Student ID</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in students" :key="item.id">
            <td>{{ item.last_name }}, {{ item.first_name }}</td>
            <td>{{ item.student_id }}</td>
            <td>
              <div class="admin-actions">
                <button type="button" class="dot-button" @click="openDetails(item)">
                  ...
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showDetails" class="modal-backdrop">
      <div class="modal">
        <h2>
          {{ selected?.first_name }} {{ selected?.last_name }}
        </h2>
        <p class="muted">Student ID: {{ selected?.student_id }}</p>

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
              <span v-if="details.lastCheckout.gear_name">
                — {{ details.lastCheckout.gear_name }}
              </span>
            </p>
            <p v-else class="muted">No checkout history.</p>
          </div>

          <div>
            <h3>Last return</h3>
            <p v-if="details?.lastReturn">
              {{ formatTime(details.lastReturn.action_time) }}
              <span v-if="details.lastReturn.gear_name">
                — {{ details.lastReturn.gear_name }}
              </span>
            </p>
            <p v-else class="muted">No return history.</p>
          </div>
        </div>

        <div class="admin-actions">
          <button type="button" class="link" @click="removeSelected">
            Remove student
          </button>
          <button type="button" class="link" @click="closeDetails">Close</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { getAuthState } from "../../../store/authState";
import {
  createStudent,
  deleteStudent,
  fetchStudentDetails,
  fetchStudents,
  type StudentDetails,
  type StudentItem,
} from "../../../services/studentService";
import { logAdminAction } from "../../../services/auditLogService";
import { enforceAdminRateLimit } from "../../../services/rateLimitService";
import { sanitizeInput } from "../../../utils/inputSanitizer";

const students = ref<StudentItem[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref("");
const success = ref("");
const showDetails = ref(false);
const detailsLoading = ref(false);
const details = ref<StudentDetails | null>(null);
const selected = ref<StudentItem | null>(null);
const toastTitle = ref("");
const toastMessage = ref("");

const firstName = ref("");
const lastName = ref("");
const studentId = ref("");
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

const showDuplicateStudentToast = () => {
  showToast(
    "Unable to add student.",
    "Check student ID number and make sure it does not match another student's ID number. If you believe this is an error, please contact support with the student detils that you want to add"
  );
};

const showInputLimitToast = () => {
  showToast(
    "Input limit reached.",
    "One or more fields are too long. Shorten the field that is too long and try again."
  );
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
};


const handleCreate = async () => {
  error.value = "";
  success.value = "";
  const firstSanitized = sanitizeInput(firstName.value, { maxLen: 80 });
  const lastSanitized = sanitizeInput(lastName.value, { maxLen: 80 });
  const studentSanitized = sanitizeInput(studentId.value, { maxLen: 32 });

  firstName.value = firstSanitized.value;
  lastName.value = lastSanitized.value;
  studentId.value = studentSanitized.value;

  const inputError =
    firstSanitized.error || lastSanitized.error || studentSanitized.error;
  if (inputError) {
    error.value = inputError;
    showInputLimitToast();
    return;
  }
  if (!firstName.value.trim() || !lastName.value.trim() || !studentId.value.trim()) {
    error.value = "First name, last name, and student ID are required.";
    return;
  }
  const normalizedStudentId = studentId.value.trim().toLowerCase();
  const isDuplicateStudentId = students.value.some(
    (item) => item.student_id.trim().toLowerCase() === normalizedStudentId
  );
  if (isDuplicateStudentId) {
    showDuplicateStudentToast();
    return;
  }

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
      first_name: firstName.value.trim(),
      last_name: lastName.value.trim(),
      student_id: studentId.value.trim(),
    });
    await logAdminAction({
      action_type: "student_create",
      entity_type: "student",
      entity_id: created.id,
      metadata: { student_id: created.student_id },
    });
    students.value = [created, ...students.value];
    firstName.value = "";
    lastName.value = "";
    studentId.value = "";
    success.value = "Student added.";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to create student. If you belive this is an error, please contact support.";
    const message = err instanceof Error ? err.message.toLowerCase() : "";
    if (message.includes("duplicate") || message.includes("already")) {
      showDuplicateStudentToast();
    } else if (
      message.includes("invalid request") ||
      message.includes("characters or less")
    ) {
      showInputLimitToast();
    }
  } finally {
    isSaving.value = false;
  }
};

onMounted(loadStudents);

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
  const confirmed = window.confirm(
    `Remove student "${item.first_name} ${item.last_name}"? This action cannot be undone.`
  );
  if (!confirmed) return;
  error.value = "";
  success.value = "";
  isSaving.value = true;
  try {
    await enforceAdminRateLimit();
    await deleteStudent(item.id);
    await logAdminAction({
      action_type: "student_remove",
      entity_type: "student",
      entity_id: item.id,
      metadata: { student_id: item.student_id },
    });
    students.value = students.value.filter((row) => row.id !== item.id);
    success.value = "Student removed.";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Unable to remove student. Please sign out completeley and sign back in.";
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
</script>
